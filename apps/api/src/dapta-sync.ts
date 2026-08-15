import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { getAccountOnboarding, getMe, getMemberIdentity, sql, type Db } from '@quill/db';
import type { ServerEnv } from '@quill/config/env';
import type { AccountOnboarding, Attribution } from '@quill/types';
import { DB, ENV } from './tokens';
import { OutboxSkipError } from './email-effects';
import type { DaptaSyncPayload } from './dapta-sync-effects';

/**
 * Worker-side delivery of a `dapta_sync` outbox row: push a new account's
 * onboarding into the Dapta estate.
 *
 * Two external systems, called in a load-bearing order:
 *
 *   1. IAM `POST /onboarding/responses` — stores the answers that exist in
 *      Dapta's own question bank and computes the lead score. Only on the
 *      `complete` action, and only when there is at least one mappable answer.
 *   2. The FlowStudio contact-sync flow — upserts the HubSpot contact by
 *      email. The flow itself reads the answers back FROM the IAM (they do not
 *      travel in the webhook body), which is why the IAM write must land
 *      first: called in the other order, the flow would sync a contact with no
 *      answers and nothing would ever retry it.
 *
 * Failure policy mirrors AnalyticsCapture, because the outbox reads it the
 * same way: network/timeout/429/5xx → throw (retry with backoff); a 4xx from
 * the flow → OutboxSkipError (permanent, recorded once). One deliberate
 * exception: a permanent IAM rejection LOGS and falls through to the flow
 * call instead of skipping the row — the contact sync is independently
 * valuable, and the answers remain safe in our own database either way.
 */
@Injectable()
export class DaptaSyncDelivery {
  private readonly log = new Logger('DaptaSyncDelivery');
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl: typeof fetch = fetch;
  /** Question-bank cache — one GET per burst of signups, not one per row. */
  private bank: { fetchedAt: number; questions: IamQuestion[] } | null = null;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Optional() @Inject(ENV) private readonly env?: ServerEnv,
  ) {}

  /** The worker's executor for a `dapta_sync` outbox row. */
  async deliver(action: string, payloadJson: string, signal?: AbortSignal): Promise<void> {
    signal ??= AbortSignal.timeout(120_000);
    const flowUrl = this.env?.DAPTA_SYNC_FLOW_URL;
    const flowKey = this.env?.DAPTA_SYNC_FLOW_KEY;
    if (!flowUrl || !flowKey) {
      // A row enqueued before the env was removed. A decision, not a failure.
      throw new OutboxSkipError('dapta_sync: flow URL/key not configured');
    }

    const payload = JSON.parse(payloadJson) as DaptaSyncPayload;

    // Everything below is read fresh — see DaptaSyncPayload for why.
    const identity = await getMemberIdentity(this.db, payload.accountId, payload.memberId);
    if (!identity?.externalId) {
      // Local-auth accounts have no Dapta identity — and the flow's own code
      // dies silently on an unknown user_id, so refusing here is the only
      // place this failure is ever visible.
      throw new OutboxSkipError('dapta_sync: member has no external identity');
    }
    if (!identity.email) {
      // Email is the flow's upsert key; without it the call can do nothing.
      throw new OutboxSkipError('dapta_sync: member has no email');
    }
    const me = await getMe(this.db, payload.accountId, payload.memberId);
    const state = await getAccountOnboarding(this.db, payload.accountId);
    const blob = state?.onboarding ?? null;
    const account = await this.db.get<{ external_id: string | null }>(
      sql`SELECT external_id FROM account WHERE id = ${payload.accountId} LIMIT 1`,
    );

    if (action === 'complete' && blob) {
      await this.pushIamResponses(identity.externalId, blob, signal);
    }

    const body = buildFlowPayload({
      email: identity.email,
      userId: identity.externalId,
      accountExternalId: account?.external_id ?? null,
      displayName: me?.displayName ?? null,
      blob,
      attribution: me?.attribution ?? null,
    });

    let res: Response;
    try {
      res = await this.fetchImpl(flowUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': flowKey },
        body: JSON.stringify(body),
        // The flow holds a fixed 2s Wait node inside; observed end-to-end run
        // is ~3.5s, so the analytics default of 10s would sit too close to the
        // healthy path.
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(FLOW_TIMEOUT_MS)]) : AbortSignal.timeout(FLOW_TIMEOUT_MS),
      });
    } catch (err) {
      // Network-level: unreachable, DNS, TLS, timeout. All transient.
      throw new Error(`dapta_sync flow call failed: ${String(err)}`);
    }
    if (!res.ok) {
      if (res.status === 429 || res.status >= 500) {
        throw new Error(`dapta_sync flow call failed: HTTP ${res.status}`);
      }
      throw new OutboxSkipError(`dapta_sync: flow rejected ${action} with HTTP ${res.status}`);
    }
  }

  /**
   * Write the mappable answers to the IAM, guarded by its own status endpoint.
   *
   * The guard is what makes a retried row safe: `POST /onboarding/responses`
   * flips `has_completed_onboarding` on first success, so a retry that finds
   * it already flipped must not post again (double-posting semantics are
   * unspecified upstream). It also covers the `dapta` cohort for free — those
   * users completed Dapta's own onboarding, the status reads completed, and
   * nothing is posted on their behalf.
   */
  private async pushIamResponses(
    externalId: string,
    blob: AccountOnboarding,
    signal?: AbortSignal,
  ): Promise<void> {
    const base = this.env?.IAM_BASE_URL?.replace(/\/+$/, '');
    const key = this.env?.IAM_API_KEY;
    // No IAM configured is a deployment shape, not an error: the flow call
    // still runs and the answers stay in our own database.
    if (!base || !key) return;
    // Nothing mappable — the whole `dapta` cohort — makes NO IAM request at
    // all, not even the bank fetch.
    if (!hasMappableAnswer(blob)) return;

    const { responses, unmapped } = buildIamResponses(blob, await this.questionBank(base, key, signal));
    if (unmapped.length > 0) {
      // Keys only, never values — an answer is a person's data.
      this.log.warn(`dapta_sync: no IAM home for answer(s): ${unmapped.join(', ')}`);
    }
    if (responses.length === 0) return;

    const status = await this.iamGet<{ has_completed_onboarding?: boolean }>(
      `${base}/onboarding/status/${encodeURIComponent(externalId)}`,
      key,
      signal,
    );
    if (status.has_completed_onboarding) return;

    let res: Response;
    try {
      res = await this.fetchImpl(`${base}/onboarding/responses`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': key },
        body: JSON.stringify({ user_id: externalId, responses }),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(IAM_TIMEOUT_MS)]) : AbortSignal.timeout(IAM_TIMEOUT_MS),
      });
    } catch (err) {
      throw new Error(`dapta_sync IAM responses failed: ${String(err)}`);
    }
    if (res.ok) return;
    if (res.status === 429 || res.status >= 500) {
      throw new Error(`dapta_sync IAM responses failed: HTTP ${res.status}`);
    }
    // Permanent rejection: log and fall through to the flow call — see the
    // class docblock for why this is not a row-level skip.
    this.log.warn(`dapta_sync: IAM rejected responses with HTTP ${res.status}`);
  }

  /** GET against the IAM where any failure is transient (throw → retry). */
  private async iamGet<T>(url: string, key: string, signal?: AbortSignal): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        headers: { 'x-api-key': key },
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(IAM_TIMEOUT_MS)]) : AbortSignal.timeout(IAM_TIMEOUT_MS),
      });
    } catch (err) {
      throw new Error(`dapta_sync IAM GET failed: ${String(err)}`);
    }
    if (!res.ok) throw new Error(`dapta_sync IAM GET failed: HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  /**
   * The IAM's pre-signup question bank, cached briefly. The bank changes on
   * the order of months; the TTL exists so a burst of signups shares one GET,
   * not so the cache is ever meaningfully stale.
   */
  private async questionBank(base: string, key: string, signal?: AbortSignal): Promise<IamQuestion[]> {
    const now = Date.now();
    if (this.bank && now - this.bank.fetchedAt < BANK_TTL_MS) return this.bank.questions;
    const questions = await this.iamGet<IamQuestion[]>(
      `${base}/onboarding/questions?stage=pre_signup`,
      key,
      signal,
    );
    this.bank = { fetchedAt: now, questions };
    return questions;
  }
}

/** Observed live run ~3.5s (the flow holds a fixed 2s Wait node inside). */
const FLOW_TIMEOUT_MS = 15_000;
const IAM_TIMEOUT_MS = 10_000;
const BANK_TTL_MS = 5 * 60_000;

/** The subset of the IAM question shape this mapper reads. */
export interface IamQuestion {
  id: string;
  question_key?: string;
  options?: Array<{ id: string; option_value?: string }>;
}

/**
 * Which of our answers map into Dapta's bank, by the bank's own stable
 * `question_key` — NEVER by hardcoded question UUIDs, which belong to another
 * team's database. Our option values are a verified subset of the bank's
 * `option_value`s (the industry list, CRM list and volume buckets were copied
 * from it verbatim), so the option lookup is an identity match.
 *
 * `leadSource` and `useCase` are deliberately absent: the bank has no such
 * questions, so they live only in our own database until Dapta adds them.
 */
const IAM_QUESTION_FIELDS = [
  ['industry', 'industry'],
  ['crm', 'crm_usage'],
  ['leadVolume', 'contacts_per_month'],
] as const satisfies ReadonlyArray<readonly [keyof AccountOnboarding, string]>;

/** Does this blob hold at least one answer the IAM bank has a home for? */
export function hasMappableAnswer(blob: AccountOnboarding): boolean {
  return IAM_QUESTION_FIELDS.some(([field]) => {
    const value = blob[field];
    return typeof value === 'string' && value.length > 0;
  });
}

/**
 * Build the IAM responses payload from the stored blob. Pure — unit-testable
 * without a database or network. An answer whose question or option is missing
 * from the bank is returned in `unmapped` (by key) rather than dropped
 * silently, so the caller can log that the bank drifted.
 */
export function buildIamResponses(
  blob: AccountOnboarding,
  bank: IamQuestion[],
): {
  responses: Array<{ question_id: string; selected_option_ids: string[] }>;
  unmapped: string[];
} {
  const responses: Array<{ question_id: string; selected_option_ids: string[] }> = [];
  const unmapped: string[] = [];
  for (const [field, questionKey] of IAM_QUESTION_FIELDS) {
    const value = blob[field];
    if (typeof value !== 'string' || !value) continue;
    const question = bank.find((q) => q.question_key === questionKey);
    const option = question?.options?.find((o) => o.option_value === value);
    if (!question || !option) {
      unmapped.push(field);
      continue;
    }
    responses.push({ question_id: question.id, selected_option_ids: [option.id] });
  }
  return { responses, unmapped };
}

/** What the contact-sync flow's trigger accepts. */
export interface FlowPayload {
  email: string;
  user_id: string;
  account_id?: string;
  phone?: string;
  name?: string;
  params?: Record<string, string>;
}

/**
 * The flow's `isValidPhone` floor, mirrored so we never send a value the flow
 * would classify as junk (it stores phone into the contact's primary field).
 */
const MIN_PHONE_LENGTH = 7;

/**
 * Build the flow webhook body. Pure — unit-testable.
 *
 * `params` is FLAT and carries only the three utm_* keys the flow's code
 * actually reads (`utm_source`, `utm_medium`, `utm_campaign`) — verified
 * against the flow's own JSON. gclid/fbclid have no vehicle and are dropped.
 * Empty values are omitted entirely; an empty `params` omits the field.
 */
export function buildFlowPayload(input: {
  email: string;
  userId: string;
  accountExternalId: string | null;
  displayName: string | null;
  blob: AccountOnboarding | null;
  attribution: Attribution | null;
}): FlowPayload {
  const body: FlowPayload = { email: input.email, user_id: input.userId };
  if (input.accountExternalId) body.account_id = input.accountExternalId;
  if (input.displayName) body.name = input.displayName;

  const phone = input.blob?.phone?.trim();
  if (phone && phone.length >= MIN_PHONE_LENGTH) body.phone = phone;

  const params: Record<string, string> = {};
  const a = input.attribution;
  if (a?.utmSource) params.utm_source = a.utmSource;
  if (a?.utmMedium) params.utm_medium = a.utmMedium;
  if (a?.utmCampaign) params.utm_campaign = a.utmCampaign;
  if (Object.keys(params).length > 0) body.params = params;

  return body;
}
