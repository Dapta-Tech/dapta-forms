/**
 * The mirror-form submission, as a TAIL EFFECT of a HubSpot delivery.
 *
 * The contact upsert is the delivery. Posting to the mirror form is what turns
 * that into a "Form submission" activity the CRM user recognises — and it is
 * strictly extra. It needs a scope the upsert does not (`form-submissions-write`),
 * it targets a different host, and it is not idempotent, so it must never throw:
 * a thrown error would send the outbox round again and duplicate an activity for
 * a contact that already synced.
 *
 * WHICH of the two writes carries the mapped values is a separate question, and
 * the answer changed: see `hubspot-mirror-attribution.spec.ts`. This file is
 * about the post itself — where it goes, what it carries, and what it does when
 * the portal says no.
 */
import { describe, it, expect } from 'vitest';
import { HubspotDestination } from './hubspot';
import type { DestinationContext } from '../destination.port';

const FORMS_BASE = 'https://forms.test';
const API_BASE = 'https://api.test';

/**
 * Is this call aimed at the forms host?
 *
 * Compares the ORIGIN rather than testing a prefix. `startsWith` would also
 * match `https://forms.test.example.com`, which is the same reasoning that makes
 * prefix checks a real vulnerability in routing code — CodeQL flags it here for
 * exactly that pattern. In a test harness it is not a security hole, but it is
 * still a sloppy matcher: the whole point of these tests is that the mirror goes
 * to a DIFFERENT host from the CRM API, so the check should say host.
 */
const isFormsHost = (url: string): boolean => {
  try {
    return new URL(url).origin === FORMS_BASE;
  } catch {
    return false;
  }
};
const silent = { warn: () => {} };

function ctx(over: Partial<DestinationContext> = {}): DestinationContext {
  return {
    idempotencyKey: 'submission:sub-1:complete:hubspot',
    submissionId: 'sub-1',
    formId: 'form-1',
    formName: 'Lead Qualifier',
    accountId: 'acc-1',
    sessionId: 'sess-1',
    score: 18,
    outcomeLabel: 'Qualified',
    phase: 'complete',
    submittedAt: Date.UTC(2026, 0, 15, 22, 30),
    data: { contact_email: 'lead@acme.io', first: 'Ada' },
    utm: {},
    ...over,
  } as DestinationContext;
}

const OPTS = {
  token: 't',
  fieldMappings: { contact_email: 'email', first: 'firstname' },
  note: false as const,
  portalId: '23824272',
  formGuid: 'guid-1',
};

/** Records every call; the upsert always succeeds so the tail effect is reached. */
function harness(mirror: { status?: number; throws?: boolean } = {}) {
  const calls: { url: string; body: unknown }[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, body });
    if (isFormsHost(url)) {
      if (mirror.throws) throw new Error('network down');
      const status = mirror.status ?? 200;
      return { ok: status < 400, status, text: async () => 'nope', json: async () => ({}) };
    }
    return { ok: true, status: 200, json: async () => ({ results: [{ id: 'contact-9' }] }) };
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const mirrorCalls = (calls: { url: string }[]) => calls.filter((c) => isFormsHost(c.url));

describe('HubspotDestination — the mirror form submission', () => {
  it('posts to the SECURE submit URL for the configured portal and form', async () => {
    const { calls, fetchImpl } = harness();
    const dest = new HubspotDestination(OPTS, fetchImpl, API_BASE, silent, FORMS_BASE);
    const result = await dest.deliver(ctx());

    const mirror = mirrorCalls(calls);
    expect(mirror).toHaveLength(1);
    expect(mirror[0]!.url).toBe(
      `${FORMS_BASE}/submissions/v3/integration/secure/submit/23824272/guid-1`,
    );
    expect(result.detail).toContain('+form');
  });

  it('sends every mapped property, and the form name as context', async () => {
    const { calls, fetchImpl } = harness();
    const dest = new HubspotDestination(OPTS, fetchImpl, API_BASE, silent, FORMS_BASE);
    await dest.deliver(ctx());

    const body = mirrorCalls(calls)[0]!.body as {
      fields: { name: string; value: string }[];
      context?: { pageName?: string };
    };
    expect(body.fields).toEqual(
      expect.arrayContaining([
        { objectTypeId: '0-1', name: 'email', value: 'lead@acme.io' },
        { objectTypeId: '0-1', name: 'firstname', value: 'Ada' },
      ]),
    );
    expect(body.context?.pageName).toBe('Lead Qualifier');
  });

  it('does nothing at all when no mirror form is configured', async () => {
    const { calls, fetchImpl } = harness();
    const dest = new HubspotDestination(
      { ...OPTS, formGuid: undefined },
      fetchImpl,
      API_BASE,
      silent,
      FORMS_BASE,
    );
    const result = await dest.deliver(ctx());
    expect(mirrorCalls(calls)).toHaveLength(0);
    // Silent, not "failed": the feature is off, and saying so on every single
    // submission would bury the deliveries that really did go wrong.
    expect(result.detail).not.toContain('form');
    expect(result.delivered).toBe(true);
  });

  it('does nothing when the portal could not be resolved', async () => {
    const { calls, fetchImpl } = harness();
    const dest = new HubspotDestination(
      { ...OPTS, portalId: undefined },
      fetchImpl,
      API_BASE,
      silent,
      FORMS_BASE,
    );
    await dest.deliver(ctx());
    expect(mirrorCalls(calls)).toHaveLength(0);
  });

  it('leaves PARTIAL submissions alone', async () => {
    // A partial is an intermediate save; an activity per keystroke-batch would
    // bury the real submission in the contact's timeline.
    const { calls, fetchImpl } = harness();
    const dest = new HubspotDestination(OPTS, fetchImpl, API_BASE, silent, FORMS_BASE);
    await dest.deliver(ctx({ phase: 'partial' }));
    expect(mirrorCalls(calls)).toHaveLength(0);
  });

  it('reports a MISSING SCOPE without failing the delivery', async () => {
    // 403 = the portal never granted `form-submissions-write`. Retrying cannot
    // change that, and the contact has already synced.
    const { fetchImpl } = harness({ status: 403 });
    const dest = new HubspotDestination(OPTS, fetchImpl, API_BASE, silent, FORMS_BASE);
    const result = await dest.deliver(ctx());
    expect(result.delivered).toBe(true);
    expect(result.detail).toContain('form failed');
  });

  it('survives the forms host being unreachable', async () => {
    const { fetchImpl } = harness({ throws: true });
    const dest = new HubspotDestination(OPTS, fetchImpl, API_BASE, silent, FORMS_BASE);
    const result = await dest.deliver(ctx());
    expect(result.delivered).toBe(true);
    expect(result.detail).toContain('form failed');
  });

  it('still writes the contact when the mirror submit fails', async () => {
    // The ordering guarantee: the upsert is the delivery, the mirror is extra.
    const { calls, fetchImpl } = harness({ status: 500 });
    const dest = new HubspotDestination(OPTS, fetchImpl, API_BASE, silent, FORMS_BASE);
    const result = await dest.deliver(ctx());
    expect(calls.some((c) => c.url.includes('/crm/v3/objects/contacts/batch/upsert'))).toBe(true);
    expect(result.detail).toContain('contact=contact-9');
  });

  it('skips the post when nothing mapped produced a value', async () => {
    const { calls, fetchImpl } = harness();
    const dest = new HubspotDestination(
      { ...OPTS, fieldMappings: { contact_email: 'email' } },
      fetchImpl,
      API_BASE,
      silent,
      FORMS_BASE,
    );
    // No email in the data at all — `deliver` bails before the upsert, so there
    // is nothing to mirror either.
    const result = await dest.deliver(ctx({ data: {} }));
    expect(mirrorCalls(calls)).toHaveLength(0);
    expect(result.delivered).toBe(false);
  });

  it('does not send a property the mirror form does not declare', async () => {
    // The mirror declares what the MAPPINGS name. `inferCompanyFromEmail` fills
    // `company`/`website` outside them, and HubSpot rejects a submission naming
    // an undeclared field — which would turn enrichment into a hard failure.
    const { calls, fetchImpl } = harness();
    const dest = new HubspotDestination(
      { ...OPTS, inferCompanyFromEmail: true },
      fetchImpl,
      API_BASE,
      silent,
      FORMS_BASE,
    );
    await dest.deliver(ctx());
    const body = mirrorCalls(calls)[0]!.body as { fields: { name: string }[] };
    const names = body.fields.map((f) => f.name);
    expect(names).not.toContain('company');
    expect(names).not.toContain('website');
  });
});
