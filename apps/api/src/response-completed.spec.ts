/**
 * `forms_response_completed`, asserted at its real call site: the public
 * submission path, on SQLite in memory, with the outbox as the observable. One
 * event per NEW complete response, nothing for partials, refusals or retries,
 * and nothing in it that a respondent typed.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createDb, migrate, seed, listOutbox, getAccountByCode, createForm, type Db } from '@quill/db';
import { SubmissionNotifier, LogOnlyEmailProvider } from '@quill/notifications';
import { SubmissionService } from './submission.service';
import { EmailEffects } from './email-effects';
import { AnalyticsEffects } from './analytics-effects';
import type { CaptchaCheck, CaptchaVerdict, CaptchaVerifier } from './captcha';

let db: Db;

const ENV_ON = {
  PRODUCT_ANALYTICS_KEY: 'phc_test',
  PRODUCT_ANALYTICS_HOST: 'https://x.test',
  IAM_STAFF_DOMAINS: ['staff.example.com'],
} as never;

const ANALYTICS_ID = '019a6b2e-7c3d-7e4f-8a5b-1c2d3e4f5a6b';
const slug = 'guide';

class FakeVerifier implements CaptchaVerifier {
  readonly provider = 'turnstile' as const;
  readonly siteKey = 'site-key';
  readonly enabled = true;
  constructor(public verdict: CaptchaVerdict = { outcome: 'passed' }) {}
  async verify(_check: CaptchaCheck): Promise<CaptchaVerdict> {
    return this.verdict;
  }
}

interface Captured {
  event: string;
  distinctId: string;
  uuid?: string;
  accountId: string | null;
  properties: Record<string, unknown>;
}

async function captured(): Promise<Captured[]> {
  const rows = await listOutbox(db, { kind: 'analytics' });
  return rows
    .map((r) => JSON.parse(String(r.payload)) as Captured)
    .filter((p) => p.event === 'forms_response_completed');
}

const BASE_STEPS = [
  { key: 'email', type: 'email', question: 'Email?' },
  { key: 'full_name', type: 'text', question: 'Name?' },
  { key: 'ig_cuenta', type: 'text', question: 'IG', hidden: true },
  { key: 'utm_term', type: 'text', question: 'Term', hidden: true },
  { key: 'email_prefill', type: 'text', question: 'Prefilled email', hidden: true },
];

async function publish(extra: Record<string, unknown> = {}, steps: unknown[] = BASE_STEPS) {
  const account = await getAccountByCode(db, 'acme');
  const created = await createForm(db, account!.id, {
    name: 'LM guide',
    slug,
    config: { version: 1, steps, ...extra } as never,
  });
  if (!created.ok) throw new Error('createForm failed');
  return { formId: created.value.id, accountId: account!.id };
}

function service(opts: { analytics?: unknown; verifier?: CaptchaVerifier; uploads?: unknown } = {}) {
  const email = new EmailEffects(new SubmissionNotifier(new LogOnlyEmailProvider()), db);
  const analytics = 'analytics' in opts ? opts.analytics : new AnalyticsEffects(db, ENV_ON);
  return new SubmissionService(
    db,
    email,
    undefined,
    undefined,
    analytics as never,
    opts.uploads as never,
    opts.verifier,
  );
}

const complete = (s: SubmissionService, extra: Record<string, unknown> = {}) =>
  s.submit('acme', slug, { sessionId: 'sess-1', data: { email: 'lead@example.com' }, ...extra });

beforeEach(async () => {
  db = await createDb('file::memory:');
  await migrate(db);
  await seed(db);
});

afterEach(async () => {
  await db.close();
});

describe('forms_response_completed: when it fires', () => {
  it('a complete enqueues exactly one event, grouped by the form account', async () => {
    const { formId, accountId } = await publish();
    const out = await complete(service());
    expect('error' in out).toBe(false);
    const events = await captured();
    expect(events).toHaveLength(1);
    const [e] = events;
    expect(e!.accountId).toBe(accountId);
    expect(e!.uuid).toBe((out as { id: string }).id);
    expect(e!.properties).toMatchObject({
      form_id: formId,
      form_slug: slug,
      form_name: 'LM guide',
      account_code: 'acme',
      account_id: accountId,
      response_id: (out as { id: string }).id,
      embedded: false,
      page_host: null,
      layout: 'slides',
      outcome_id: null,
      has_booking: false,
      has_file_answer: false,
      locale: null,
      respondent_is_staff: false,
      $geoip_disable: true,
    });
  });

  it('a partial enqueues nothing; the complete of the same session enqueues one', async () => {
    await publish();
    const s = service();
    await s.submit('acme', slug, { sessionId: 'sess-1', data: { email: 'lead@example.com' }, partial: true });
    expect(await captured()).toHaveLength(0);
    await complete(s);
    expect(await captured()).toHaveLength(1);
  });

  it('a complete re-landed by a transport retry enqueues no second event', async () => {
    await publish();
    const s = service();
    await complete(s);
    await complete(s);
    expect(await captured()).toHaveLength(1);
  });

  it('spam protection with the verifier down saves a partial and enqueues nothing; the retry that passes enqueues one', async () => {
    await publish({ spamProtection: { captcha: true } });
    const verifier = new FakeVerifier({ outcome: 'unavailable', reason: 'timeout' });
    const s = service({ verifier });
    const first = await complete(s, { captchaToken: 'tok' });
    expect(first).toMatchObject({ error: 'CAPTCHA_UNAVAILABLE' });
    expect(await captured()).toHaveLength(0);
    verifier.verdict = { outcome: 'passed' };
    const second = await complete(s, { captchaToken: 'tok' });
    expect('error' in second).toBe(false);
    expect(await captured()).toHaveLength(1);
  });

  it('a refused response enqueues nothing: invalid answers, a failed check, a bad upload', async () => {
    await publish({ spamProtection: { captcha: true } }, [
      { key: 'email', type: 'email', question: 'Email?', required: true },
    ]);
    const verifier = new FakeVerifier({ outcome: 'failed', reason: 'invalid-input-response' });
    const invalid = await service({ verifier }).submit('acme', slug, { sessionId: 's-a', data: { email: 'nope' } });
    expect(invalid).toMatchObject({ error: 'INVALID_ANSWERS' });
    const refused = await complete(service({ verifier }), { captchaToken: 'forged' });
    expect(refused).toMatchObject({ error: 'CAPTCHA_FAILED' });

    verifier.verdict = { outcome: 'passed' };
    const uploads = {
      enabled: true,
      maxFileMb: 10,
      verifyAnswers: vi.fn(async () => ({ error: 'INVALID_UPLOAD', message: 'bad', status: 400 })),
    };
    const badUpload = await complete(service({ verifier, uploads }), { captchaToken: 'tok' });
    expect(badUpload).toMatchObject({ error: 'INVALID_UPLOAD' });
    expect(await captured()).toHaveLength(0);
  });

  it('enqueues nothing without PRODUCT_ANALYTICS_KEY', async () => {
    await publish();
    await complete(service({ analytics: new AnalyticsEffects(db, {} as never) }));
    expect(await listOutbox(db, { kind: 'analytics' })).toHaveLength(0);
  });

  it('a throwing analytics observer never fails the response', async () => {
    await publish();
    const analytics = {
      enabled: true,
      staffDomains: [],
      // Only this event throws: the activation capture beside it is not under test.
      capture: vi.fn(async (event: string) => {
        if (event === 'response_completed') throw new Error('enqueue exploded');
      }),
    };
    const out = await complete(service({ analytics }));
    expect('error' in out).toBe(false);
    expect(analytics.capture).toHaveBeenCalledWith('response_completed', expect.anything());
  });
});

describe('forms_response_completed: what it carries', () => {
  it('carries no answer, email, name, prefilled email or full page URL', async () => {
    await publish();
    await complete(service(), {
      data: {
        email: 'ana.private@example.com',
        full_name: 'Ana Secreta',
        email_prefill: 'prefill.private@example.com',
        utm: { utm_source: 'ig_homerovende', utm_medium: 'dm', utm_secret: 'zzz-secret' },
      },
      visit: {
        pageUri: 'https://landing.example.com/offer?email=ana.private%40example.com',
        pageName: 'Private page name',
        embedded: true,
      },
    });
    const json = JSON.stringify(await listOutbox(db, { kind: 'analytics' }));
    for (const secret of ['ana.private', 'Ana Secreta', 'prefill.private', 'zzz-secret', 'Private page name', '/offer']) {
      expect(json).not.toContain(secret);
    }
    const [e] = await captured();
    expect(e!.properties).toMatchObject({
      utm_source: 'ig_homerovende',
      utm_medium: 'dm',
      embedded: true,
      page_host: 'landing.example.com',
    });
  });

  it('sends hidden steps under the utm_ and ig_ prefixes only', async () => {
    await publish();
    await complete(service(), {
      data: { email: 'lead@example.com', ig_cuenta: 'homerovende', utm_term: 'guia', email_prefill: 'x@example.com' },
    });
    const [e] = await captured();
    expect(e!.properties.hidden_ig_cuenta).toBe('homerovende');
    expect(e!.properties.hidden_utm_term).toBe('guia');
    expect(e!.properties).not.toHaveProperty('hidden_email_prefill');
  });

  it('reads the redirect the response leaves through: host, path and its utm tags, never answer tokens', async () => {
    await publish({
      ending: {
        redirectUrl:
          'https://dforms.ai/ventas/?utm_source=ig_homerovende&utm_medium=social&utm_campaign=vsl_ventas&utm_content=guia_formularios&who=[email]',
      },
    });
    await complete(service());
    const [e] = await captured();
    expect(e!.properties).toMatchObject({
      redirect_host: 'dforms.ai',
      redirect_path: '/ventas/',
      redirect_utm_source: 'ig_homerovende',
      redirect_utm_medium: 'social',
      redirect_utm_campaign: 'vsl_ventas',
      redirect_utm_content: 'guia_formularios',
    });
    expect(JSON.stringify(e)).not.toContain('lead@example.com');
  });

  it('an outcome with a booking reports its own redirect and has_booking', async () => {
    await publish({
      ending: { redirectUrl: 'https://example.com/form-level' },
      outcomes: [
        {
          id: 'hot',
          label: 'Hot',
          minScore: 0,
          redirectUrl: 'https://dforms.ai/after-booking?utm_source=ig_a',
          booking: { provider: 'calendly', url: 'https://calendly.com/x/30min' },
        },
      ],
    });
    await complete(service());
    const [e] = await captured();
    expect(e!.properties).toMatchObject({
      outcome_id: 'hot',
      has_booking: true,
      redirect_host: 'dforms.ai',
      redirect_path: '/after-booking',
      redirect_utm_source: 'ig_a',
    });
  });

  it('tags a staff respondent without sending the address', async () => {
    await publish();
    await complete(service(), { data: { email: 'tester@staff.example.com' } });
    const [e] = await captured();
    expect(e!.properties.respondent_is_staff).toBe(true);
    expect(JSON.stringify(e)).not.toContain('tester@staff.example.com');
  });

  it('the one-page layout and the locale the respondent saw', async () => {
    await publish({ layout: 'vertical', language: 'es' });
    await complete(service(), { locale: 'en' });
    const [e] = await captured();
    expect(e!.properties).toMatchObject({ layout: 'vertical', locale: 'en' });
  });
});

describe('forms_response_completed: distinct id', () => {
  it('uses the renderer analytics id, with a person profile, when it is a UUID', async () => {
    await publish();
    await complete(service(), { analyticsId: ANALYTICS_ID.toUpperCase() });
    const [e] = await captured();
    expect(e!.distinctId).toBe(ANALYTICS_ID);
    expect(e!.properties.stitched).toBe(true);
    expect(e!.properties).not.toHaveProperty('$process_person_profile');
  });

  it('falls back to response:<id> with no person profile when absent or malformed', async () => {
    await publish();
    const s = service();
    const a = await s.submit('acme', slug, { sessionId: 's-a', data: { email: 'a@example.com' } });
    const b = await s.submit('acme', slug, {
      sessionId: 's-b',
      data: { email: 'b@example.com' },
      analyticsId: 'b@example.com',
    });
    expect('error' in b).toBe(false);
    const events = await captured();
    expect(events.map((e) => e.distinctId)).toEqual([
      `response:${(a as { id: string }).id}`,
      `response:${(b as { id: string }).id}`,
    ]);
    for (const e of events) {
      expect(e.properties.stitched).toBe(false);
      expect(e.properties.$process_person_profile).toBe(false);
    }
  });
});
