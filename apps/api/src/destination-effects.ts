import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  deleteUnstartedOutbox,
  enqueueOutbox,
  resolveProviderToken,
  skipBackoffOutbox,
  type Db,
  type OutboxKind,
} from '@quill/db';
import {
  createDestination,
  type DeliveryTranscript,
  type DestinationContext,
  type DestinationSpec,
  type DnsResolver,
} from '@quill/destinations';
import {
  destinationFiresForPhase,
  destinationType,
  formConfigSchema,
  formDestinationSchema,
  type FormDestination,
} from '@quill/types';
import type { ServerEnv } from '@quill/config/env';
import { HubspotPortalResolver, mirrorGuidFor } from './hubspot-portal';
import { DB, ENV } from './tokens';

/**
 * Every destination kind the form config can name, as queue kinds.
 *
 * Read off the destination contract instead of restated here, so the two cannot
 * drift: `satisfies` proves at COMPILE TIME that each destination type is a kind
 * the queue accepts, and a destination kind added to the contract joins the
 * cancellation pass below without anyone remembering to widen a list.
 */
const DESTINATION_OUTBOX_KINDS = destinationType satisfies readonly OutboxKind[];

/** The delivery snapshot serialized into an outbox row (config + context). */
interface DestinationOutboxPayload {
  destination: FormDestination;
  ctx: DestinationContext;
}

/** What a persisted submission hands the effects layer to fan out to destinations. */
export interface SubmissionDeliveryInput {
  formId: string;
  formName: string;
  accountId: string;
  submissionId: string;
  sessionId: string;
  score: number;
  outcomeLabel: string | null;
  phase: 'partial' | 'complete';
  submittedAt: number;
  /** The submission answers. */
  data: Record<string, unknown>;
  /** The stored form config (destinations are read from it). */
  config: unknown;
}

/**
 * Durable SUBMISSION DESTINATIONS (CRM/webhook sync). On a persisted submission
 * every ENABLED destination is ENQUEUED as an `outbox` row (kind = the
 * destination type) instead of delivered inline; the OutboxWorker drains it with
 * retry+backoff. Delivery NEVER blocks or fails submission handling — enqueueing
 * is wrapped so a bad config can't throw into the submit path, and the actual
 * HTTP call happens later in the worker. Mirrors EmailEffects exactly.
 */
@Injectable()
export class DestinationEffects {
  private readonly log = new Logger('DestinationEffects');
  /** Injectable for tests; defaults to global fetch for destination delivery. */
  fetchImpl: typeof fetch = fetch;
  /** Injectable DNS resolver for tests (webhook SSRF guard); default = Node DNS. */
  resolveDns?: DnsResolver;
  /** accountId -> the portal its HubSpot token belongs to (mirror submit URL). */
  private readonly portals = new HubspotPortalResolver();

  constructor(
    @Inject(DB) private readonly db: Db,
    @Optional() @Inject(ENV) private readonly env?: ServerEnv,
  ) {}

  /**
   * Enqueue a delivery for every enabled destination on the form. Never rejects
   * — the caller fire-and-forgets with `void`; a persisted submission is the
   * durable fact, destination sync is best-effort-but-retried on top of it.
   */
  async enqueueSubmissionDeliveries(input: SubmissionDeliveryInput): Promise<void> {
    try {
      const destinations = extractDestinations(input.config);
      const enabled = destinations
        .map((destination, index) => ({ destination, index }))
        .filter(({ destination }) => destination.enabled !== false)
        // Per-event trigger filter: a destination with an `events` list only fires
        // for the phases it names (webhook `events:['complete']` skips partials, and
        // vice versa). Absent/empty `events` fires on BOTH phases (back-compat), and
        // destinations without the field (e.g. HubSpot) always pass — the helper
        // returns true. Mapping happens BEFORE this filter so the idempotency key
        // keeps each destination's ORIGINAL config-array index.
        .filter(({ destination }) => destinationFiresForPhase(destination, input.phase));

      // A re-submit of the same session+phase reconsiders what the PREVIOUS
      // pass left queued, for EVERY destination kind rather than the ones
      // firing now. Deriving the set from `enabled` asked the one question that
      // cannot describe the previous pass: a destination disabled, deleted, or
      // narrowed to another phase drops out of `enabled`, so its leftovers were
      // never looked at and delivered under a config nobody had any more.
      //
      // The three pending states are three different facts and get three
      // different answers, in this order:
      //
      //   NEVER HANDED OFF   deleted. Nothing happened, so nothing is lost.
      //   WAITING TO RETRY   settled `skipped`, if it is unclaimed at the
      //                      moment this pass runs. It DID happen, so it keeps
      //                      everything it recorded, but its payload is a
      //                      snapshot this pass has just replaced and every
      //                      remaining retry would deliver stale content.
      //   IN FLIGHT          untouched. A worker holds it and may already have
      //                      reached the endpoint, so settling it belongs to
      //                      the worker side, not to this pass. If that worker
      //                      abandons its lease the row stays claimed and
      //                      another may reclaim it; either way, not us.
      //
      // THIS PASS SPEAKS FOR THE QUEUE AS IT FINDS IT, not for what the queue
      // becomes afterwards, and it cannot bound what a held row does next. That
      // attempt may succeed and finish `done`, may fail and drop back into
      // backoff unclaimed, or may lose its lease and stay claimed for another
      // worker. Because the row queued just below is due immediately and a
      // backed-off retry is not, Dapta Forms can send the OLDER payload after
      // this pass's newer one and then mark that older row done. `max_attempts`
      // caps how many further retries follow; it does not un-send the ones
      // already made. A later pass for the same submission and phase settles
      // such a row if it is unclaimed by then, but there may be no later pass:
      // partials can come round again, while a re-landed complete does not
      // re-enqueue at all. What a receiver makes of the two is outside Dapta
      // Forms. The residual is the price of not touching a row somebody else
      // owns, and it is deliberate.
      //
      // Running both writes per kind BEFORE the enqueue loop is what keeps a
      // sibling destination of the same kind safe: doing it inside the loop
      // would clear a row this same pass had just written.
      for (const kind of DESTINATION_OUTBOX_KINDS) {
        const scope = { subjectUid: input.submissionId, kind, action: input.phase };
        await deleteUnstartedOutbox(this.db, scope);
        await skipBackoffOutbox(this.db, scope);
      }

      for (const { destination, index } of enabled) {
        // Every firing destination is queued, unconditionally. The answers this
        // pass carries are the ones the respondent actually left, and declining
        // to queue them because an older delivery is still on the wire would
        // discard the newer of the two for good.
        //
        // Per-destination identity: the config-array index disambiguates two
        // destinations of the same type, so each delivery carries its own
        // idempotency key (receivers de-dup per destination, not per type).
        const idempotencyKey = `submission:${input.submissionId}:${input.phase}:${destination.type}:${index}`;
        const ctx: DestinationContext = {
          idempotencyKey,
          submissionId: input.submissionId,
          formId: input.formId,
          formName: input.formName,
          accountId: input.accountId,
          sessionId: input.sessionId,
          score: input.score,
          outcomeLabel: input.outcomeLabel,
          phase: input.phase,
          submittedAt: input.submittedAt,
          data: input.data,
          utm: extractUtm(input.data),
        };
        const payload: DestinationOutboxPayload = { destination, ctx };
        await enqueueOutbox(this.db, {
          kind: destination.type,
          action: input.phase,
          subjectUid: input.submissionId,
          accountId: input.accountId,
          payload: JSON.stringify(payload),
        });
      }
    } catch (err) {
      this.log.error(`failed to enqueue submission destinations: ${String(err)}`);
    }
  }

  /**
   * The worker's executor for a destination outbox row (kind webhook/hubspot).
   * Rebuilds the destination (injecting the server-side HubSpot token at delivery
   * time — it is never stored in the payload) and delivers. A THROWN transport
   * error propagates so the worker retries; a permanent no-op (delivered:false)
   * resolves so the row is marked done.
   */
  /** Returns what crossed the wire, for the queue to record. */
  async deliver(action: string, payloadJson: string): Promise<DeliveryTranscript> {
    const { destination, ctx } = JSON.parse(payloadJson) as DestinationOutboxPayload;
    // ctx.accountId is the form's account — resolve that account's HubSpot token
    // (else the env fallback) at delivery time.
    const spec = await this.toSpec(destination, ctx.accountId);
    const dest = createDestination(spec, this.fetchImpl);
    const result = await dest.deliver(ctx);
    if (!result.delivered) {
      this.log.warn(
        `destination ${destination.type} (${ctx.submissionId}/${action}) no-op via ${result.driver}` +
          (result.detail ? `: ${result.detail}` : ''),
      );
    } else {
      this.log.log(
        `destination ${destination.type} (${ctx.submissionId}/${action}) delivered` +
          (result.detail ? `: ${result.detail}` : ''),
      );
    }
    return {
      requestBody: result.requestBody,
      responseStatus: result.responseStatus,
      responseBody: result.responseBody,
    };
  }

  /** Resolve a stored destination config into a delivery spec (inject secrets). */
  private async toSpec(destination: FormDestination, accountId: string): Promise<DestinationSpec> {
    if (destination.type === 'webhook') {
      return {
        type: 'webhook',
        webhook: {
          url: destination.settings.url,
          secret: destination.settings.secret ?? undefined,
          signatureHeader: destination.settings.signatureHeader ?? undefined,
          timeoutMs: destination.settings.timeoutMs,
          // SSRF guard: permit loopback webhook targets only outside production
          // (a local dev catcher). In prod, loopback/private hosts are rejected.
          allowLocalhost: (this.env?.NODE_ENV ?? 'development') !== 'production',
          resolveDns: this.resolveDns,
        },
      };
    }
    // Per-account HubSpot token (connected → decrypted), else the env fallback.
    // Null resolves to '' so the factory degrades to a harmless log-only no-op.
    const token = await resolveProviderToken(
      this.db,
      accountId,
      'hubspot',
      this.env?.FORMS_ENCRYPTION_KEY,
      this.env?.HUBSPOT_PRIVATE_APP_TOKEN,
    );
    const mirrorGuid = mirrorGuidFor(destination.settings);
    return {
      type: 'hubspot',
      hubspot: {
        // Server-side secret, injected at delivery time — never persisted.
        token: token ?? '',
        fieldMappings: destination.fieldMappings ?? {},
        utmMappings: destination.utmMappings ?? {},
        scoreProperty: destination.scoreProperty ?? undefined,
        dateProperty: destination.dateProperty ?? undefined,
        note: destination.settings?.note,
        valueMaps: destination.valueMaps,
        outcomeProperty: destination.outcomeProperty ?? undefined,
        staticProperties: destination.staticProperties,
        inferCompanyFromEmail: destination.inferCompanyFromEmail,
        // The mirror form and the portal its submit URL carries: see
        // `mirrorGuidFor` and `HubspotPortalResolver`, shared with the
        // booking-time path so the two cannot disagree on what enables it.
        formGuid: mirrorGuid ?? undefined,
        portalId: mirrorGuid
          ? ((await this.portals.resolve(accountId, token ?? '', this.fetchImpl)) ?? undefined)
          : undefined,
      },
    };
  }

}

/** Read the destinations array from a stored config, tolerating legacy/absent. */
function extractDestinations(config: unknown): FormDestination[] {
  const parsed = formConfigSchema.safeParse(config);
  if (parsed.success) return parsed.data.destinations ?? [];
  // A config that fails full validation still shouldn't break sync — best-effort:
  // validate each destination entry on its own.
  if (config && typeof config === 'object' && Array.isArray((config as { destinations?: unknown }).destinations)) {
    const out: FormDestination[] = [];
    for (const d of (config as { destinations: unknown[] }).destinations) {
      const one = formDestinationSchema.safeParse(d);
      if (one.success) out.push(one.data);
    }
    return out;
  }
  return [];
}

/**
 * Pull UTM values from a submission. The renderer's convention (PR #4) is a
 * NESTED `data.utm` object (`data: {..., utm: {utm_source, utm_medium, ...}}`) —
 * that is the primary source. Flat top-level `utm_*` answer keys are accepted as
 * a robustness fallback only; they never override a nested value.
 */
export function extractUtm(data: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  const add = (key: string, value: unknown) => {
    if (key in out) return; // first writer wins — nested is written first
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      out[key] = String(value).trim();
    }
  };
  const nested = data.utm;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    for (const [key, value] of Object.entries(nested as Record<string, unknown>)) add(key, value);
  }
  for (const [key, value] of Object.entries(data)) {
    if (/^utm_/i.test(key)) add(key, value);
  }
  return out;
}
