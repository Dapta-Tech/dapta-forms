/**
 * The core public loop, end to end on in-memory SQLite: fetch the seeded form,
 * submit answers (score recomputed server-side), verify the row + the enqueued
 * outbox email, and record a funnel event.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createDb,
  migrate,
  seed,
  listOutbox,
  listSubmissions,
  recordFormEvent,
  upsertNotificationSetting,
  getAccountByCode,
  createForm,
  sql,
  type Db,
} from '@quill/db';
import { computeScore } from '@quill/engine';
import { SubmissionNotifier, LogOnlyEmailProvider } from '@quill/notifications';
import { SubmissionService } from './submission.service';
import { EmailEffects } from './email-effects';
import { DestinationEffects } from './destination-effects';
import { NoopCaptchaVerifier, type CaptchaCheck, type CaptchaVerdict, type CaptchaVerifier } from './captcha';

let db: Db;
let svc: SubmissionService;

beforeEach(async () => {
  db = await createDb('file::memory:');
  await migrate(db);
  await seed(db);
  const email = new EmailEffects(new SubmissionNotifier(new LogOnlyEmailProvider()), db);
  svc = new SubmissionService(db, email);
});

afterEach(async () => {
  await db.close();
});

/**
 * The submit path fire-and-forgets its email enqueues (`void this.email…`);
 * yield one macrotask so those promise chains settle before asserting outbox
 * contents (the SQLite driver is synchronous — one turn drains everything).
 */
const flushEffects = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('public form', () => {
  it('serves the seeded form config', async () => {
    const f = await svc.publicForm('acme', 'lead-qualifier');
    expect(f?.name).toBe('Lead Qualifier');
    expect(f?.config.version).toBe(1);
    expect(f?.config.steps.length).toBeGreaterThan(0);
  });

  it('404s an unknown slug', async () => {
    expect(await svc.publicForm('acme', 'nope')).toBeNull();
  });
});

describe('submit', () => {
  it('persists the submission with a SERVER-computed score and enqueues the email', async () => {
    const out = await svc.submit('acme', 'lead-qualifier', {
      sessionId: 'sess-1',
      // founder(10) + team 20→(8) = 18 ≥ 12 → qualified. Client-sent score is impossible by design.
      data: { role: 'founder', team_size: 20, company: 'Acme', email: 'lead@acme.io' },
    });
    expect('error' in out).toBe(false);
    if ('error' in out) return;
    expect(out.score).toBe(18);
    expect(out.outcome).toBe('qualified');
    await flushEffects();

    const form = await db.get<{ id: string }>(sql`SELECT id FROM form WHERE slug = 'lead-qualifier' LIMIT 1`);
    const rows = await listSubmissions(db, form!.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.score).toBe(18);
    expect(rows[0]!.completedAt).not.toBeNull();

    // Durable emails: the owner notice AND the respondent confirmation (the
    // answers carried an email) were both enqueued as outbox rows.
    const outbox = await listOutbox(db, { kind: 'email' });
    expect(outbox.map((r) => r.action).sort()).toEqual([
      'submission_confirmed',
      'submission_received',
    ]);
    const confirmed = outbox.find((r) => r.action === 'submission_confirmed')!;
    const payload = JSON.parse(confirmed.payload!) as { to: string[]; respondentEmail: string };
    expect(payload.to).toEqual(['lead@acme.io']); // addressed to the respondent
    expect(payload.respondentEmail).toBe('lead@acme.io');
  });

  it('the respondent receipt renders in the language the respondent saw, then the form language, then none', async () => {
    const localeOf = async (sessionId: string, extra: Record<string, unknown>, language?: 'en' | 'es') => {
      if (language) {
        const form = await db.get<{ id: string; config: string }>(
          sql`SELECT id, config FROM form WHERE slug = 'lead-qualifier' LIMIT 1`,
        );
        const config = JSON.parse(form!.config) as Record<string, unknown>;
        await db.run(
          sql`UPDATE form SET config = ${JSON.stringify({ ...config, language })} WHERE id = ${form!.id}`,
        );
      }
      await svc.submit('acme', 'lead-qualifier', {
        sessionId,
        data: { role: 'founder', team_size: 20, email: 'lead@acme.io' },
        ...extra,
      });
      await flushEffects();
      const rows = await listOutbox(db, { kind: 'email' });
      const confirmed = rows.filter((r) => r.action === 'submission_confirmed').pop()!;
      return (JSON.parse(confirmed.payload!) as { locale: string | null }).locale;
    };
    expect(await localeOf('sess-loc-none', {})).toBeNull();
    expect(await localeOf('sess-loc-seen', { locale: 'es' })).toBe('es');
    expect(await localeOf('sess-loc-form', {}, 'es')).toBe('es');
    // What the respondent SAW wins over the form default (a ?lang=en link on a Spanish form).
    expect(await localeOf('sess-loc-both', { locale: 'en' }, 'es')).toBe('en');
  });

  it('both emails carry the answers as resolved {label, value} rows in step order', async () => {
    await svc.submit('acme', 'lead-qualifier', {
      sessionId: 'sess-answers',
      data: { role: 'founder', team_size: 20, company: 'Acme', email: 'lead@acme.io' },
    });
    await flushEffects();
    const outbox = await listOutbox(db, { kind: 'email' });
    expect(outbox).toHaveLength(2);
    for (const row of outbox) {
      const payload = JSON.parse(row.payload!) as { answers: Array<{ label: string; value: string }> };
      expect(payload.answers.map((a) => a.label)).toEqual([
        'What best describes you?',
        'How big is your team?',
        'What company do you work at?',
        'Where should we send the results?',
      ]);
      // Option VALUE → option LABEL, numbers stringified.
      expect(payload.answers[0]!.value).not.toBe('founder');
      expect(payload.answers[1]!.value).toBe('20');
      expect(payload.answers[2]!.value).toBe('Acme');
      expect(payload.answers[3]!.value).toBe('lead@acme.io');
    }
  });

  it('a re-landed complete enqueues NO second round of effects', async () => {
    // `callActionWithRetry` cannot abort an in-flight request, so a complete
    // that landed slowly IS retried and this method runs twice for one real
    // submission. The row dedupes itself; the effects must too — without the
    // gate, owner and respondent each got a duplicate email and a drained CRM
    // delivery duplicated its activity.
    const payload = {
      sessionId: 'sess-retry',
      data: { role: 'founder', team_size: 20, company: 'Acme', email: 'lead@acme.io' },
    };
    const first = await svc.submit('acme', 'lead-qualifier', payload);
    const retried = await svc.submit('acme', 'lead-qualifier', payload);
    await flushEffects();

    // Same verdict both times — the retry is invisible to the visitor.
    expect('error' in first || 'error' in retried).toBe(false);
    if ('error' in first || 'error' in retried) return;
    expect(retried.id).toBe(first.id);
    expect(retried.score).toBe(first.score);

    // Exactly ONE owner notice and ONE respondent receipt, not two of each.
    const outbox = await listOutbox(db, { kind: 'email' });
    expect(outbox.map((r) => r.action).sort()).toEqual(['submission_confirmed', 'submission_received']);
  });

  it('a partial→complete transition still fires the complete effects once', async () => {
    // The gate must key on "was ALREADY completed", not "row existed" — the
    // normal partial-then-final flow reuses the row and must still notify.
    await svc.submit('acme', 'lead-qualifier', {
      sessionId: 'sess-partial-then-final',
      partial: true,
      data: { role: 'founder' },
    });
    await svc.submit('acme', 'lead-qualifier', {
      sessionId: 'sess-partial-then-final',
      data: { role: 'founder', team_size: 20, email: 'lead@acme.io' },
    });
    await flushEffects();
    const outbox = await listOutbox(db, { kind: 'email' });
    expect(outbox.map((r) => r.action).sort()).toEqual(['submission_confirmed', 'submission_received']);
  });

  it('a completed submission WITHOUT an email enqueues only the owner notice', async () => {
    await svc.submit('acme', 'lead-qualifier', {
      sessionId: 'sess-noemail',
      data: { role: 'founder', team_size: 20, company: 'Acme' },
    });
    await flushEffects();
    const outbox = await listOutbox(db, { kind: 'email' });
    expect(outbox.map((r) => r.action)).toEqual(['submission_received']);
  });

  it('the submission_confirmed notification toggle suppresses the receipt (owner notice unaffected)', async () => {
    const account = await db.get<{ id: string }>(sql`SELECT id FROM account WHERE code = 'acme' LIMIT 1`);
    await upsertNotificationSetting(db, account!.id, 'submission_confirmed', { enabled: false });
    await svc.submit('acme', 'lead-qualifier', {
      sessionId: 'sess-muted',
      data: { role: 'founder', team_size: 20, email: 'lead@acme.io' },
    });
    await flushEffects();
    const outbox = await listOutbox(db, { kind: 'email' });
    expect(outbox.map((r) => r.action)).toEqual(['submission_received']);
  });

  it('threads the form id into the effects: a PER-FORM template override is snapshotted', async () => {
    const account = await db.get<{ id: string }>(sql`SELECT id FROM account WHERE code = 'acme' LIMIT 1`);
    const form = await db.get<{ id: string }>(sql`SELECT id FROM form WHERE slug = 'lead-qualifier' LIMIT 1`);
    // Account-level copy + a form-level pin — the form's copy must win.
    await upsertNotificationSetting(db, account!.id, 'submission_confirmed', { subject: 'ACCT {{formName}}' });
    await upsertNotificationSetting(
      db,
      account!.id,
      'submission_confirmed',
      { subject: 'FORM {{formName}}' },
      Date.now(),
      form!.id,
    );

    await svc.submit('acme', 'lead-qualifier', {
      sessionId: 'sess-form-override',
      data: { role: 'founder', team_size: 20, email: 'lead@acme.io' },
    });
    await flushEffects();

    const outbox = await listOutbox(db, { kind: 'email' });
    const confirmed = outbox.find((r) => r.action === 'submission_confirmed')!;
    const payload = JSON.parse(confirmed.payload!) as { subjectTemplate: string | null };
    expect(payload.subjectTemplate).toBe('FORM {{formName}}');
  });

  it('a partial save does not enqueue any email', async () => {
    await svc.submit('acme', 'lead-qualifier', {
      sessionId: 'sess-2',
      data: { role: 'individual', email: 'partial@acme.io' },
      partial: true,
    });
    await flushEffects();
    expect(await listOutbox(db, { kind: 'email' })).toHaveLength(0);
  });

  it('resolves the outcome WITH answers so answer-forced overrides match the client', async () => {
    const account = await getAccountByCode(db, 'acme');
    const created = await createForm(db, account!.id, {
      name: 'Override form',
      config: {
        version: 1,
        steps: [
          {
            key: 'leads',
            type: 'slider',
            question: 'Leads?',
            min: 0,
            max: 100,
            flowGroup: 'qualification',
            sliderScoring: [{ min: 0, max: 100, points: 10 }],
          },
        ],
        scoring: { enabled: true },
        outcomes: [
          { id: 'p1', label: 'P1', minScore: 5 },
          { id: 'p0', label: 'P0', minScore: -100, overrides: [{ field: 'leads', maxValue: 0 }] },
        ],
      },
    });
    if (!created.ok) throw new Error('createForm failed');

    // leads=0 scores +10 (≥ p1's minScore) — only the override can pick p0.
    const out = await svc.submit('acme', created.value.slug, {
      sessionId: 'sess-override',
      data: { leads: 0 },
    });
    expect('error' in out).toBe(false);
    if ('error' in out) return;
    expect(out.score).toBe(10);
    expect(out.outcome).toBe('p0');
  });

  it('rejects a long-text answer over the ceiling its question sets', async () => {
    const account = await getAccountByCode(db, 'acme');
    const created = await createForm(db, account!.id, {
      name: 'Long text form',
      config: {
        version: 1,
        steps: [
          { key: 'why', type: 'textarea', question: 'Why?', minChars: 20, maxChars: 50 },
          { key: 'other', type: 'textarea', question: 'Anything else?' },
        ],
      },
    });
    if (!created.ok) throw new Error('createForm failed');
    const slug = created.value.slug;

    const over = await svc.submit('acme', slug, {
      sessionId: 'sess-too-long',
      data: { why: 'a'.repeat(51) },
    });
    expect('error' in over).toBe(true);
    if (!('error' in over)) return;
    expect(over.error).toBe('ANSWER_TOO_LONG');
    expect(over.status).toBe(400);
    // Nothing was persisted: the check runs before the row is written.
    expect(await listSubmissions(db, created.value.id)).toHaveLength(0);

    // A partial save carries the same ceiling: a giant string is the same
    // problem whichever phase sends it.
    const partial = await svc.submit('acme', slug, {
      sessionId: 'sess-too-long-partial',
      data: { why: 'a'.repeat(51) },
      partial: true,
    });
    expect('error' in partial).toBe(true);

    // The FLOOR is browser-side only, on purpose: a short answer still lands.
    const short = await svc.submit('acme', slug, { sessionId: 'sess-short', data: { why: 'hi' } });
    expect('error' in short).toBe(false);

    // A long-text question with NO ceiling is not measured at all.
    const unbounded = await svc.submit('acme', slug, {
      sessionId: 'sess-unbounded',
      data: { why: 'a'.repeat(30), other: 'b'.repeat(5000) },
    });
    expect('error' in unbounded).toBe(false);
  });

  it('scores a jump on a screen (#200) exactly as the respondent walked it, like the client', async () => {
    const account = await getAccountByCode(db, 'acme');
    const option = (value: string, points: number) => ({ label: value, value, points });
    const config = {
      version: 1 as const,
      scoring: { enabled: true },
      steps: [
        // One screen: a jump on its FIRST question runs when the screen is
        // left, so `budget` is still shown and scored; `extra` is skipped.
        {
          key: 'fit',
          type: 'multiple_choice' as const,
          question: 'Fit?',
          options: [option('yes', 5), option('no', 0)],
          goto: [{ values: ['yes'], target: 'last' }],
          screenGroup: 'qualify',
        },
        {
          key: 'budget',
          type: 'multiple_choice' as const,
          question: 'Budget?',
          options: [option('high', 3), option('low', 1)],
          screenGroup: 'qualify',
        },
        { key: 'extra', type: 'multiple_choice' as const, question: 'Extra?', options: [option('x', 100)] },
        { key: 'last', type: 'multiple_choice' as const, question: 'Last?', options: [option('z', 7)] },
      ],
    };
    const created = await createForm(db, account!.id, { name: 'Screens score', config });
    if (!created.ok) throw new Error('createForm failed');

    // A stale answer to the skipped question never counts.
    const data = { fit: 'yes', budget: 'high', extra: 'x', last: 'z' };
    const out = await svc.submit('acme', created.value.slug, { sessionId: 'sess-screens', data });
    expect('error' in out).toBe(false);
    if ('error' in out) return;
    // fit(5) + budget(3) + last(7).
    expect(out.score).toBe(15);
    expect(out.score).toBe(computeScore(config, data));
  });
});

/**
 * A verifier whose verdicts the test scripts, recording every check it is
 * asked for. The real adapter is covered in `captcha.spec.ts`; here the point
 * is what the SERVICE does with each verdict.
 */
class FakeVerifier implements CaptchaVerifier {
  readonly provider = 'turnstile' as const;
  readonly siteKey = 'site-key';
  readonly checks: CaptchaCheck[] = [];
  constructor(
    public verdict: CaptchaVerdict = { outcome: 'passed' },
    readonly enabled = true,
  ) {}
  async verify(check: CaptchaCheck): Promise<CaptchaVerdict> {
    this.checks.push(check);
    return this.verdict;
  }
}

describe('spam protection (captcha)', () => {
  let destinations: DestinationEffects;
  let verifier: FakeVerifier;
  let protectedSvc: SubmissionService;
  let formId: string;
  const slug = 'protected-form';

  /** A published form with the check switched on and both destinations listening. */
  async function publishProtected(spamProtection: Record<string, unknown> | null = { captcha: true }) {
    const account = await getAccountByCode(db, 'acme');
    const created = await createForm(db, account!.id, {
      name: 'Protected form',
      slug,
      config: {
        version: 1,
        steps: [
          { key: 'email', type: 'email', question: 'Email?' },
          { key: 'company', type: 'text', question: 'Company?' },
        ],
        // No `events`: the webhook listens to BOTH phases, the default a new
        // webhook is born with, and HubSpot always upserts on a partial.
        destinations: [
          { type: 'webhook', enabled: true, settings: { url: 'https://hooks.example.com/in' } },
          { type: 'hubspot', enabled: true, settings: {} },
        ],
        ...(spamProtection ? { spamProtection } : {}),
      } as never,
    });
    if (!created.ok) throw new Error('createForm failed');
    formId = created.value.id;
  }

  function build(v: CaptchaVerifier | undefined, uploads?: unknown) {
    const email = new EmailEffects(new SubmissionNotifier(new LogOnlyEmailProvider()), db);
    return new SubmissionService(db, email, destinations, undefined, undefined, uploads as never, v);
  }

  const deliveries = async () =>
    [...(await listOutbox(db, { kind: 'webhook' })), ...(await listOutbox(db, { kind: 'hubspot' }))];
  const emails = () => listOutbox(db, { kind: 'email' });
  const eventTypes = async () =>
    (
      await db.all<{ type: string }>(sql`SELECT type FROM form_event WHERE form_id = ${formId} ORDER BY created_at`)
    ).map((r) => r.type);

  beforeEach(async () => {
    destinations = new DestinationEffects(db);
    verifier = new FakeVerifier();
    protectedSvc = build(verifier);
    await publishProtected();
  });

  it('refuses a complete submit without a token: 403, a readable message, nothing written', async () => {
    const out = await protectedSvc.submit('acme', slug, {
      sessionId: 'sess-no-token',
      data: { email: 'lead@example.com' },
    });
    expect(out).toMatchObject({ error: 'CAPTCHA_REQUIRED', status: 403 });
    // An old cached renderer shows `message` verbatim, so it has to be usable as is.
    expect((out as { message: string }).message).toMatch(/refresh the page/i);
    await flushEffects();
    expect(await listSubmissions(db, formId)).toHaveLength(0);
    expect(await deliveries()).toHaveLength(0);
    expect(await emails()).toHaveLength(0);
    expect(verifier.checks).toHaveLength(0);
  });

  it('refuses a token the verifier rejects: 403, no row, no outbox, a server-written event', async () => {
    verifier.verdict = { outcome: 'failed', reason: 'invalid-input-response' };
    const out = await protectedSvc.submit('acme', slug, {
      sessionId: 'sess-bad-token',
      data: { email: 'lead@example.com' },
      captchaToken: 'forged',
    });
    expect(out).toMatchObject({ error: 'CAPTCHA_FAILED', status: 403 });
    await flushEffects();
    expect(await listSubmissions(db, formId)).toHaveLength(0);
    expect(await deliveries()).toHaveLength(0);
    expect(await emails()).toHaveLength(0);
    expect(await eventTypes()).toEqual(['captcha_failed']);
  });

  it('checks the token against THIS session and the client address the controller resolved', async () => {
    await protectedSvc.submit(
      'acme',
      slug,
      { sessionId: 'sess-ip', data: { email: 'lead@example.com' }, captchaToken: 'tok' },
      { remoteIp: '203.0.113.9' },
    );
    expect(verifier.checks).toEqual([{ token: 'tok', sessionId: 'sess-ip', remoteIp: '203.0.113.9' }]);
  });

  it('a verified complete is written and delivers everything: emails, webhook and HubSpot', async () => {
    const out = await protectedSvc.submit('acme', slug, {
      sessionId: 'sess-ok',
      data: { email: 'lead@example.com', company: 'Acme' },
      captchaToken: 'tok',
    });
    expect('error' in out).toBe(false);
    await flushEffects();
    const rows = await listSubmissions(db, formId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.completedAt).not.toBeNull();
    expect((await deliveries()).map((r) => `${r.kind}:${r.action}`).sort()).toEqual([
      'hubspot:complete',
      'webhook:complete',
    ]);
    expect((await emails()).map((r) => r.action).sort()).toEqual(['submission_confirmed', 'submission_received']);
  });

  it('a partial is saved but NOTHING is delivered while protection is on, and the complete then delivers', async () => {
    const partial = await protectedSvc.submit('acme', slug, {
      sessionId: 'sess-partial',
      data: { email: 'lead@example.com' },
      partial: true,
    });
    expect('error' in partial).toBe(false);
    await flushEffects();
    const rows = await listSubmissions(db, formId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.partialAt).not.toBeNull();
    expect(await deliveries()).toHaveLength(0);
    // A partial is never checked: there is nothing to challenge mid-form.
    expect(verifier.checks).toHaveLength(0);

    await protectedSvc.submit('acme', slug, {
      sessionId: 'sess-partial',
      data: { email: 'lead@example.com', company: 'Acme' },
      captchaToken: 'tok',
    });
    await flushEffects();
    expect((await deliveries()).map((r) => `${r.kind}:${r.action}`).sort()).toEqual([
      'hubspot:complete',
      'webhook:complete',
    ]);
  });

  it('a direct partial carrying a full answer set is saved and still not delivered', async () => {
    await protectedSvc.submit('acme', slug, {
      sessionId: 'sess-direct-partial',
      data: { email: 'bot@example.com', company: 'Bot Inc' },
      partial: true,
    });
    await flushEffects();
    expect(await listSubmissions(db, formId)).toHaveLength(1);
    expect(await deliveries()).toHaveLength(0);
  });

  it('when the check is unavailable the answers are kept as a partial and the API answers 503', async () => {
    verifier.verdict = { outcome: 'unavailable', reason: 'timeout' };
    const out = await protectedSvc.submit('acme', slug, {
      sessionId: 'sess-down',
      data: { email: 'lead@example.com', company: 'Acme' },
      captchaToken: 'tok',
    });
    expect(out).toMatchObject({ error: 'CAPTCHA_UNAVAILABLE', status: 503 });
    await flushEffects();
    const rows = await listSubmissions(db, formId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.completedAt).toBeNull();
    expect(rows[0]!.partialAt).not.toBeNull();
    expect(rows[0]!.data).toMatchObject({ email: 'lead@example.com', company: 'Acme' });
    expect(await deliveries()).toHaveLength(0);
    expect(await emails()).toHaveLength(0);
    expect(await eventTypes()).toEqual(['captcha_unavailable']);
  });

  it('a transport retry of a verified complete (same token) causes no second round of effects', async () => {
    const payload = { sessionId: 'sess-retry-captcha', data: { email: 'lead@example.com' }, captchaToken: 'tok' };
    const first = await protectedSvc.submit('acme', slug, payload);
    const again = await protectedSvc.submit('acme', slug, payload);
    await flushEffects();
    expect('error' in first || 'error' in again).toBe(false);
    expect((await deliveries()).map((r) => r.action)).toEqual(['complete', 'complete']);
    expect((await emails()).map((r) => r.action).sort()).toEqual(['submission_confirmed', 'submission_received']);
  });

  it('checks the token before touching uploads, which copy objects even on a partial', async () => {
    const verifyAnswers = vi.fn(async (_f: unknown, _s: string, data: Record<string, unknown>) => ({ answers: data }));
    const withUploads = build(verifier, { enabled: true, maxFileMb: 10, verifyAnswers });
    verifier.verdict = { outcome: 'failed', reason: 'invalid-input-response' };
    await withUploads.submit('acme', slug, {
      sessionId: 'sess-uploads',
      data: { email: 'lead@example.com' },
      captchaToken: 'forged',
    });
    expect(verifyAnswers).not.toHaveBeenCalled();
  });

  it('on a deployment without keys the switch is ignored: no check, partials delivered as today', async () => {
    const noKeys = build(new NoopCaptchaVerifier());
    const out = await noKeys.submit('acme', slug, { sessionId: 'sess-nokeys', data: { email: 'lead@example.com' } });
    expect('error' in out).toBe(false);
    await noKeys.submit('acme', slug, {
      sessionId: 'sess-nokeys-partial',
      data: { email: 'lead@example.com' },
      partial: true,
    });
    await flushEffects();
    expect((await deliveries()).map((r) => `${r.kind}:${r.action}`).sort()).toEqual([
      'hubspot:complete',
      'hubspot:partial',
      'webhook:complete',
      'webhook:partial',
    ]);
  });

  it('a built-without-verifier service (every existing construction) behaves exactly as before', async () => {
    const legacy = build(undefined);
    const out = await legacy.submit('acme', slug, { sessionId: 'sess-legacy', data: { email: 'lead@example.com' } });
    expect('error' in out).toBe(false);
  });

  it('with the switch off and keys loaded, nothing is checked and partials are delivered', async () => {
    await db.run(sql`DELETE FROM form WHERE id = ${formId}`);
    await publishProtected(null);
    const out = await protectedSvc.submit('acme', slug, { sessionId: 'sess-off', data: { email: 'lead@example.com' } });
    expect('error' in out).toBe(false);
    await protectedSvc.submit('acme', slug, { sessionId: 'sess-off-2', data: { email: 'x@example.com' }, partial: true });
    await flushEffects();
    expect(verifier.checks).toHaveLength(0);
    expect((await deliveries()).some((r) => r.action === 'partial')).toBe(true);
  });

  describe('the public payload', () => {
    it('carries the challenge only when the deployment has keys AND the form turned it on', async () => {
      const on = await protectedSvc.publicForm('acme', slug);
      expect(on?.captcha).toEqual({ provider: 'turnstile', siteKey: 'site-key' });
      // The owner's switch never reaches the page: the renderer acts on `captcha` alone.
      expect((on?.config as Record<string, unknown>).spamProtection).toBeUndefined();

      expect((await build(new NoopCaptchaVerifier()).publicForm('acme', slug))?.captcha).toBeUndefined();
      expect((await build(undefined).publicForm('acme', slug))?.captcha).toBeUndefined();
      expect((await protectedSvc.publicForm('acme', 'lead-qualifier'))?.captcha).toBeUndefined();
    });

    it('marks strict mode, and only while the check itself is on', async () => {
      await db.run(sql`DELETE FROM form WHERE id = ${formId}`);
      await publishProtected({ captcha: true, strict: true });
      expect((await protectedSvc.publicForm('acme', slug))?.captcha).toEqual({
        provider: 'turnstile',
        siteKey: 'site-key',
        strict: true,
      });
      await db.run(sql`DELETE FROM form WHERE id = ${formId}`);
      await publishProtected({ strict: true });
      expect((await protectedSvc.publicForm('acme', slug))?.captcha).toBeUndefined();
    });
  });

  describe('strict mode', () => {
    beforeEach(async () => {
      await db.run(sql`DELETE FROM form WHERE id = ${formId}`);
      await publishProtected({ captcha: true, strict: true });
    });

    const viewAt = (sessionId: string, at: number) =>
      recordFormEvent(db, { formId, sessionId, type: 'view', now: at });

    it('refuses a filled hidden field with the same answer as a bad token, and writes nothing', async () => {
      await viewAt('sess-hp', Date.now() - 60_000);
      const out = await protectedSvc.submit('acme', slug, {
        sessionId: 'sess-hp',
        data: { email: 'bot@example.com' },
        captchaToken: 'tok',
        hp: 'https://spam.example.com',
      });
      expect(out).toMatchObject({ error: 'CAPTCHA_FAILED', status: 403 });
      await flushEffects();
      expect(await listSubmissions(db, formId)).toHaveLength(0);
      expect(await deliveries()).toHaveLength(0);
      expect(await eventTypes()).toEqual(['view', 'spam_honeypot']);
    });

    it('refuses a complete that lands under 2 s after the session first viewed the form', async () => {
      await viewAt('sess-fast', Date.now() - 500);
      const out = await protectedSvc.submit('acme', slug, {
        sessionId: 'sess-fast',
        data: { email: 'bot@example.com' },
        captchaToken: 'tok',
        hp: '',
      });
      expect(out).toMatchObject({ error: 'CAPTCHA_FAILED', status: 403 });
      await flushEffects();
      expect(await listSubmissions(db, formId)).toHaveLength(0);
      expect(await eventTypes()).toEqual(['view', 'spam_too_fast']);
    });

    it('lets a person through: an empty hidden field, past the minimum time', async () => {
      await viewAt('sess-human', Date.now() - 45_000);
      const out = await protectedSvc.submit('acme', slug, {
        sessionId: 'sess-human',
        data: { email: 'lead@example.com' },
        captchaToken: 'tok',
        hp: '',
      });
      expect('error' in out).toBe(false);
    });

    it('never blocks a session whose view was lost: the challenge already covered it', async () => {
      const out = await protectedSvc.submit('acme', slug, {
        sessionId: 'sess-no-view',
        data: { email: 'lead@example.com' },
        captchaToken: 'tok',
      });
      expect('error' in out).toBe(false);
    });

    it('checks the token FIRST: a bad token is a plain challenge failure, whatever else is wrong', async () => {
      verifier.verdict = { outcome: 'failed', reason: 'invalid-input-response' };
      await viewAt('sess-both', Date.now() - 100);
      await protectedSvc.submit('acme', slug, {
        sessionId: 'sess-both',
        data: { email: 'bot@example.com' },
        captchaToken: 'forged',
        hp: 'filled',
      });
      expect(await eventTypes()).toEqual(['view', 'captcha_failed']);
    });
  });

  it('automatic mode ignores the hidden field and the timing', async () => {
    await recordFormEvent(db, { formId, sessionId: 'sess-auto', type: 'view', now: Date.now() - 100 });
    const out = await protectedSvc.submit('acme', slug, {
      sessionId: 'sess-auto',
      data: { email: 'lead@example.com' },
      captchaToken: 'tok',
      hp: 'filled by an extension',
    });
    expect('error' in out).toBe(false);
  });
});

/**
 * The page a submission was answered on (#199): what the service stores, what
 * it keeps of the HubSpot cookie, and which visit the deliveries carry.
 */
describe('the visit', () => {
  const HUTK = '0123456789ABCDEF0123456789abcdef';
  const LANDING = {
    pageUri: 'https://landing.example.com/offer?utm_source=fb#form',
    pageName: '  Home   insurance ',
    pageId: '12345',
    hutk: HUTK,
    hsPortalId: '4321',
    embedded: true,
  };
  const STORED = {
    pageUri: 'https://landing.example.com/offer?utm_source=fb',
    pageName: 'Home insurance',
    pageId: '12345',
    hutk: HUTK.toLowerCase(),
    hsPortalId: '4321',
    embedded: true,
  };
  const { hutk: _cookie, ...WITHOUT_COOKIE } = STORED;

  let destinations: DestinationEffects;
  let verifier: FakeVerifier;
  let formId: string;
  const slug = 'visit-form';

  async function publish(destinationsConfig: unknown[], extra: Record<string, unknown> = {}) {
    const account = await getAccountByCode(db, 'acme');
    const created = await createForm(db, account!.id, {
      name: 'Visit form',
      slug,
      config: {
        version: 1,
        steps: [
          { key: 'email', type: 'email', question: 'Email?' },
          { key: 'company', type: 'text', question: 'Company?' },
        ],
        destinations: destinationsConfig,
        ...extra,
      } as never,
    });
    if (!created.ok) throw new Error('createForm failed');
    formId = created.value.id;
  }

  function service() {
    const email = new EmailEffects(new SubmissionNotifier(new LogOnlyEmailProvider()), db);
    return new SubmissionService(db, email, destinations, undefined, undefined, undefined, verifier);
  }

  const WEBHOOK = { type: 'webhook', enabled: true, settings: { url: 'https://hooks.example.com/in' } };
  const HUBSPOT_MIRROR = { type: 'hubspot', enabled: true, settings: { formActivity: true, formGuid: 'guid-1' } };

  const storedVisit = async () => (await listSubmissions(db, formId))[0]?.visit;
  const ctxOf = async (kind: 'webhook' | 'hubspot', action: 'partial' | 'complete') => {
    const row = (await listOutbox(db, { kind })).find((r) => r.action === action);
    return (JSON.parse(row!.payload!) as { ctx: Record<string, unknown> }).ctx;
  };

  beforeEach(() => {
    destinations = new DestinationEffects(db);
    verifier = new FakeVerifier();
  });

  it('stores the visit the browser reported, sanitized, and answers as usual', async () => {
    await publish([WEBHOOK]);
    const out = await service().submit('acme', slug, {
      sessionId: 'sess-visit',
      data: { email: 'lead@example.com' },
      visit: LANDING,
    });
    expect('error' in out).toBe(false);
    expect(await storedVisit()).toEqual(STORED);
  });

  it('never refuses a submission over a malformed visit', async () => {
    await publish([WEBHOOK]);
    for (const [i, visit] of [
      'https://landing.example.com',
      { pageUri: 'javascript:alert(1)', pageName: 7, hutk: 'abc', pageId: 'x', embedded: 'yes' },
      [LANDING],
    ].entries()) {
      const out = await service().submit('acme', slug, { sessionId: `sess-bad-${i}`, data: { email: 'a@example.com' }, visit });
      expect('error' in out).toBe(false);
    }
    const rows = await listSubmissions(db, formId);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.visit === null)).toBe(true);
  });

  it('logs a dropped cookie without ever printing it', async () => {
    await publish([WEBHOOK]);
    const svc = service();
    const warn = vi.spyOn((svc as unknown as { log: { warn: (m: string) => void } }).log, 'warn');
    await svc.submit('acme', slug, {
      sessionId: 'sess-bad-cookie',
      data: { email: 'a@example.com' },
      visit: { ...LANDING, hutk: 'not-a-hubspot-cookie' },
    });
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/hutk dropped/));
    expect(JSON.stringify(warn.mock.calls)).not.toContain('not-a-hubspot-cookie');
    expect(await storedVisit()).toEqual(WITHOUT_COOKIE);
  });

  it('keeps the cookie only when a webhook or a HubSpot form submission will use it', async () => {
    const cases: Array<[string, unknown[], boolean]> = [
      ['no destination', [], false],
      ['a webhook', [WEBHOOK], true],
      ['a switched-off webhook', [{ ...WEBHOOK, enabled: false }], false],
      ['HubSpot recording the form submission', [HUBSPOT_MIRROR], true],
      ['HubSpot with the form submission off', [{ type: 'hubspot', enabled: true, settings: {} }], false],
      [
        'HubSpot with the switch on but no mirror form yet',
        [{ type: 'hubspot', enabled: true, settings: { formActivity: true } }],
        false,
      ],
    ];
    for (const [label, config, kept] of cases) {
      await db.run(sql`DELETE FROM form WHERE slug = ${slug}`);
      await publish(config);
      await service().submit('acme', slug, { sessionId: `sess-${label}`, data: { email: 'a@example.com' }, visit: LANDING });
      expect(await storedVisit(), label).toEqual(kept ? STORED : WITHOUT_COOKIE);
    }
  });

  it('delivers the MERGED visit: a partial caught it, the complete came without one', async () => {
    await publish([WEBHOOK]);
    const svc = service();
    await svc.submit('acme', slug, { sessionId: 'sess-merge', data: { email: 'a@example.com' }, partial: true, visit: LANDING });
    await svc.submit('acme', slug, { sessionId: 'sess-merge', data: { email: 'a@example.com', company: 'Acme' } });
    expect((await ctxOf('webhook', 'partial')).visit).toEqual(STORED);
    expect((await ctxOf('webhook', 'complete')).visit).toEqual(STORED);
  });

  it('enqueues exactly the payload it always did when no visit was reported', async () => {
    await publish([WEBHOOK]);
    await service().submit('acme', slug, { sessionId: 'sess-plain', data: { email: 'a@example.com' } });
    expect(await ctxOf('webhook', 'complete')).not.toHaveProperty('visit');
    expect(await ctxOf('webhook', 'complete')).not.toHaveProperty('formTitle');
  });

  it('carries the public title with a visit, for HubSpot to name an untitled page', async () => {
    await publish([HUBSPOT_MIRROR], { title: 'Get your quote' });
    await service().submit('acme', slug, {
      sessionId: 'sess-title',
      data: { email: 'a@example.com' },
      visit: { pageUri: 'https://landing.example.com/', embedded: true },
    });
    const ctx = await ctxOf('hubspot', 'complete');
    expect(ctx.formName).toBe('Visit form');
    expect(ctx.formTitle).toBe('Get your quote');
  });

  describe('with spam protection on', () => {
    beforeEach(async () => {
      await publish([WEBHOOK, HUBSPOT_MIRROR], { spamProtection: { captcha: true } });
    });

    it('a partial stores its visit and delivers nothing; the verified complete delivers it', async () => {
      const svc = service();
      await svc.submit('acme', slug, { sessionId: 'sess-p', data: { email: 'a@example.com' }, partial: true, visit: LANDING });
      expect(await storedVisit()).toEqual(STORED);
      expect(await listOutbox(db, { kind: 'webhook' })).toHaveLength(0);

      await svc.submit('acme', slug, { sessionId: 'sess-p', data: { email: 'a@example.com' }, captchaToken: 'tok' });
      expect((await ctxOf('webhook', 'complete')).visit).toEqual(STORED);
      expect((await ctxOf('hubspot', 'complete')).visit).toEqual(STORED);
    });

    it('a refused check writes nothing, visit included', async () => {
      verifier.verdict = { outcome: 'failed', reason: 'invalid-input-response' };
      const out = await service().submit('acme', slug, {
        sessionId: 'sess-refused',
        data: { email: 'a@example.com' },
        captchaToken: 'forged',
        visit: LANDING,
      });
      expect(out).toMatchObject({ status: 403 });
      expect(await listSubmissions(db, formId)).toHaveLength(0);
    });

    it('an unavailable check keeps the answers AND the visit as a partial, for the retry to complete', async () => {
      verifier.verdict = { outcome: 'unavailable', reason: 'timeout' };
      const out = await service().submit('acme', slug, {
        sessionId: 'sess-down',
        data: { email: 'a@example.com' },
        captchaToken: 'tok',
        visit: LANDING,
      });
      expect(out).toMatchObject({ status: 503 });
      expect(await storedVisit()).toEqual(STORED);
      expect(await listOutbox(db, { kind: 'webhook' })).toHaveLength(0);
    });
  });
});

describe('events', () => {
  it('records a funnel event for a valid form', async () => {
    const out = await svc.event('acme', 'lead-qualifier', { sessionId: 'sess-3', type: 'view' });
    expect('error' in out).toBe(false);
    const row = await db.get<{ n: number }>(sql`SELECT COUNT(*) AS n FROM form_event`);
    expect(Number(row?.n)).toBe(1);
  });
});

describe('booking callbacks', () => {
  it('persists a booking_event tied to the session (no enqueue without BookingEffects wired)', async () => {
    const out = await svc.booking('acme', 'lead-qualifier', {
      sessionId: 'sess-4',
      provider: 'calendly',
      eventUri: 'https://api.calendly.com/scheduled_events/abc',
      startTime: '2026-08-01T15:00:00Z',
    });
    expect('error' in out).toBe(false);

    const row = await db.get<Record<string, unknown>>(
      sql`SELECT * FROM booking_event WHERE session_id = 'sess-4' LIMIT 1`,
    );
    expect(row).toBeTruthy();
    expect(row!.provider).toBe('calendly');
    expect(Number(row!.start_time)).toBe(Date.parse('2026-08-01T15:00:00Z'));
    // BookingEffects is optional and not wired here, so nothing is enqueued —
    // the persisted booking_event stays the durable fact regardless. The
    // enqueue + booking_sync delivery path is covered in booking-sync.spec.ts.
    expect(await listOutbox(db, {})).toHaveLength(0);
  });

  it('404s an unknown form', async () => {
    const out = await svc.booking('acme', 'nope', { sessionId: 's', provider: 'calendly' });
    expect('error' in out && out.error === 'NOT_FOUND').toBe(true);
  });

  it('rejects an invalid payload (zod)', async () => {
    await expect(
      svc.booking('acme', 'lead-qualifier', { sessionId: '', provider: 'zoom' }),
    ).rejects.toThrow();
  });
});
