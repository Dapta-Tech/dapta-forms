/**
 * WHO writes the mapped properties — and therefore what the "Form submission"
 * activity says it did.
 *
 * HubSpot reports, on the activity, the properties THAT SUBMISSION changed. The
 * delivery used to upsert every mapped value through the CRM API and only then
 * post the same values to the mirror, so the post changed nothing and every card
 * in every portal read "Updated 0 properties": it named the form, listed
 * nothing, and was strictly worse than the note it was built to replace.
 * Typeform's integration never touches the CRM API — the submission IS the
 * write, which is why its cards list fields.
 *
 * So when a mirror is configured, the upsert is cut back to the contact's KEY
 * and the values ride in on the post. Three things have to stay true while that
 * happens, and each one is a test below:
 *
 *  1. the contact still exists even if the portal refuses the post — the upsert
 *     is the retryable half of the delivery and it still runs FIRST;
 *  2. a refused post still lands every mapped property, through the full upsert
 *     it falls back to;
 *  3. nothing retryable follows a SUCCESSFUL post, or the outbox would retry a
 *     delivery into a second activity on a real contact's timeline.
 *
 * A form with no mirror must behave exactly as it always did, so the no-mirror
 * path is asserted here too rather than left to the reader.
 */
import { describe, it, expect } from 'vitest';
import { HubspotDestination } from './hubspot';
import type { DestinationContext } from '../destination.port';

const FORMS_BASE = 'https://forms.test';
const API_BASE = 'https://api.test';
const UPSERT = '/crm/v3/objects/contacts/batch/upsert';

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
    data: { contact_email: 'lead@acme.io', first: 'Ada', role: 'Founder' },
    utm: {},
    ...over,
  } as DestinationContext;
}

const OPTS = {
  token: 't',
  fieldMappings: { contact_email: 'email', first: 'firstname', role: 'jobtitle' },
  note: false as const,
  portalId: '23824272',
  formGuid: 'guid-1',
};

interface Call {
  url: string;
  body: unknown;
}

/**
 * Records every call in ORDER. The upsert can be made to fail on demand, which
 * is the only way to prove the fallback is retryable rather than swallowed.
 */
function harness(
  opts: { mirrorStatus?: number; failUpsertsAfter?: number } = {},
): { calls: Call[]; fetchImpl: typeof fetch } {
  const calls: Call[] = [];
  let upserts = 0;
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, body });
    if (isFormsHost(url)) {
      const status = opts.mirrorStatus ?? 200;
      return { ok: status < 400, status, text: async () => 'nope', json: async () => ({}) };
    }
    upserts += 1;
    if (opts.failUpsertsAfter !== undefined && upserts > opts.failUpsertsAfter) {
      return { ok: false, status: 502, text: async () => 'upstream down', json: async () => ({}) };
    }
    return { ok: true, status: 200, json: async () => ({ results: [{ id: 'contact-9' }] }) };
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

/** The property names one upsert call carried. */
const upsertProperties = (call: Call): string[] =>
  Object.keys(
    (call.body as { inputs: { properties: Record<string, string> }[] }).inputs[0]!.properties,
  ).sort();

const upsertCalls = (calls: Call[]): Call[] => calls.filter((c) => c.url.includes(UPSERT));
const mirrorCalls = (calls: Call[]): Call[] => calls.filter((c) => isFormsHost(c.url));

describe('with a mirror form configured', () => {
  it('anchors the contact on its EMAIL ALONE, so the post is what sets the values', async () => {
    const { calls, fetchImpl } = harness();
    const dest = new HubspotDestination(OPTS, fetchImpl, API_BASE, silent, FORMS_BASE);
    await dest.deliver(ctx());

    // The regression, stated as an assertion: this call used to carry
    // `firstname` and `jobtitle`, which is what left the activity with nothing
    // to report.
    expect(upsertProperties(upsertCalls(calls)[0]!)).toEqual(['email']);
  });

  it('still upserts BEFORE it posts, so a refused post cannot cost the contact', async () => {
    const { calls, fetchImpl } = harness();
    const dest = new HubspotDestination(OPTS, fetchImpl, API_BASE, silent, FORMS_BASE);
    await dest.deliver(ctx());

    expect(calls[0]!.url).toContain(UPSERT);
    expect(isFormsHost(calls[1]!.url)).toBe(true);
  });

  it('carries every mapped property on the post', async () => {
    const { calls, fetchImpl } = harness();
    const dest = new HubspotDestination(OPTS, fetchImpl, API_BASE, silent, FORMS_BASE);
    await dest.deliver(ctx());

    const body = mirrorCalls(calls)[0]!.body as { fields: { name: string; value: string }[] };
    expect(body.fields.map((f) => f.name).sort()).toEqual(['email', 'firstname', 'jobtitle']);
    expect(body.fields.find((f) => f.name === 'jobtitle')?.value).toBe('Founder');
  });

  it('writes NOTHING more after a successful post', async () => {
    // The rule that keeps a retry from duplicating an activity: the post is not
    // idempotent, so it must be the last thing that can fail the delivery.
    const { calls, fetchImpl } = harness();
    const dest = new HubspotDestination(OPTS, fetchImpl, API_BASE, silent, FORMS_BASE);
    await dest.deliver(ctx());

    expect(upsertCalls(calls)).toHaveLength(1);
    expect(calls).toHaveLength(2);
  });

  it('falls back to the FULL upsert when the post is refused', async () => {
    // A portal missing `form-submissions-write` must not silently cost the
    // author every property they mapped.
    const { calls, fetchImpl } = harness({ mirrorStatus: 403 });
    const dest = new HubspotDestination(OPTS, fetchImpl, API_BASE, silent, FORMS_BASE);
    const result = await dest.deliver(ctx());

    const upserts = upsertCalls(calls);
    expect(upserts).toHaveLength(2);
    expect(upsertProperties(upserts[1]!)).toEqual(['email', 'firstname', 'jobtitle']);
    expect(result.delivered).toBe(true);
    expect(result.detail).toContain('form failed');
  });

  it('THROWS when that fallback upsert fails, because a retry cannot duplicate anything', async () => {
    // No activity was created, so sending the outbox round again is safe — and
    // necessary, or a transient 502 loses the properties for good.
    const { fetchImpl } = harness({ mirrorStatus: 500, failUpsertsAfter: 1 });
    const dest = new HubspotDestination(OPTS, fetchImpl, API_BASE, silent, FORMS_BASE);
    await expect(dest.deliver(ctx())).rejects.toThrow(/hubspot upsert failed/);
  });

  it('writes the properties the mirror does not declare, and swallows their failure', async () => {
    // `inferCompanyFromEmail` fills `company`/`website`, which are deliberately
    // absent from the mirror's fields. Without this they would silently stop
    // being written the moment an author turned the activity on.
    const { calls, fetchImpl } = harness();
    const dest = new HubspotDestination(
      { ...OPTS, inferCompanyFromEmail: true },
      fetchImpl,
      API_BASE,
      silent,
      FORMS_BASE,
    );
    await dest.deliver(ctx());

    const upserts = upsertCalls(calls);
    expect(upserts).toHaveLength(2);
    // Only the undeclared ones — re-sending the mapped values would hand the
    // CRM API the very attribution the post just earned.
    expect(upsertProperties(upserts[1]!)).toEqual(['company', 'email', 'website']);
  });

  it('does not fail a delivery whose activity landed just because the residual write did not', async () => {
    // Losing an inferred company beats retrying into a second card on a real
    // contact's timeline.
    const { fetchImpl } = harness({ failUpsertsAfter: 1 });
    const dest = new HubspotDestination(
      { ...OPTS, inferCompanyFromEmail: true },
      fetchImpl,
      API_BASE,
      silent,
      FORMS_BASE,
    );
    const result = await dest.deliver(ctx());
    expect(result.delivered).toBe(true);
    expect(result.detail).toContain('+form');
  });

  it('makes no residual call when there is nothing outside the mirror to write', async () => {
    const { calls, fetchImpl } = harness();
    const dest = new HubspotDestination(OPTS, fetchImpl, API_BASE, silent, FORMS_BASE);
    await dest.deliver(ctx());
    expect(upsertCalls(calls)).toHaveLength(1);
  });
});

describe('without a mirror form', () => {
  it('upserts every property in one call, exactly as it always did', async () => {
    const { calls, fetchImpl } = harness();
    const dest = new HubspotDestination(
      { ...OPTS, formGuid: undefined },
      fetchImpl,
      API_BASE,
      silent,
      FORMS_BASE,
    );
    await dest.deliver(ctx());

    const upserts = upsertCalls(calls);
    expect(upserts).toHaveLength(1);
    expect(upsertProperties(upserts[0]!)).toEqual(['email', 'firstname', 'jobtitle']);
    expect(mirrorCalls(calls)).toHaveLength(0);
  });

  it('upserts every property on a PARTIAL, which never mirrors', async () => {
    // Partials are the reason the branch keys on the phase as well as the guid:
    // a mirrored form still delivers partials, and those must keep writing
    // through the CRM API or an abandoned form would sync nothing at all.
    const { calls, fetchImpl } = harness();
    const dest = new HubspotDestination(OPTS, fetchImpl, API_BASE, silent, FORMS_BASE);
    await dest.deliver(ctx({ phase: 'partial' }));

    const upserts = upsertCalls(calls);
    expect(upserts).toHaveLength(1);
    expect(upsertProperties(upserts[0]!)).toEqual(['email', 'firstname', 'jobtitle']);
    expect(mirrorCalls(calls)).toHaveLength(0);
  });
});
