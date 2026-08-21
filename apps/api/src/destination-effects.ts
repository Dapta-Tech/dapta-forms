import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  deleteUnstartedOutbox,
  enqueueOutbox,
  listPendingOutbox,
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
  type HubspotDestination,
  type WebhookDestination,
} from '@quill/types';
import type { ServerEnv } from '@quill/config/env';
import { OutboxSkipError } from './email-effects';
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

/**
 * Why a delivery stood down instead of being made. This reaches the admin's
 * delivery log verbatim, so it is copy. It names no key and no digest: the row
 * it lands on is not the place to publish either.
 */
const SUPERSEDED_REASON = 'superseded by a later submission of the same session and phase';

/** The delivery snapshot serialized into an outbox row (config + context). */
interface DestinationOutboxPayload {
  destination: FormDestination;
  ctx: DestinationContext;
}

/**
 * WHAT is being delivered: the whole context bar its own key and the clock.
 *
 * `idempotencyKey` is derived from this, so it cannot be part of it. The
 * submission's `submittedAt` is left out because a re-submit that changed no
 * answer is not a different delivery, and including the clock would give every
 * pass a key of its own and defeat the whole comparison. Everything else the
 * destination receives is in here, the account included: a delivery to another
 * tenant is a different delivery even if it happens to carry the same answers.
 */
type DeliveryContent = Omit<DestinationContext, 'idempotencyKey' | 'submittedAt'>;

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
      const enabled = extractDestinations(input.config)
        .filter((destination) => destination.enabled !== false)
        // Per-event trigger filter: a destination with an `events` list only fires
        // for the phases it names (webhook `events:['complete']` skips partials, and
        // vice versa). Absent/empty `events` fires on BOTH phases (back-compat), and
        // destinations without the field (e.g. HubSpot) always pass — the helper
        // returns true.
        .filter((destination) => destinationFiresForPhase(destination, input.phase));

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
      //   WAITING TO RETRY   settled `skipped`. It DID happen, so it keeps
      //                      everything it recorded, but its payload is a
      //                      snapshot this pass has just replaced and every
      //                      remaining retry would deliver stale content.
      //   IN FLIGHT          untouched. A worker holds it and may already have
      //                      reached the endpoint, so only that worker may
      //                      settle it. Whether it is still the delivery worth
      //                      making is decided when it is made: see
      //                      {@link DestinationEffects.deliver}.
      //
      // Running both writes per kind BEFORE the enqueue loop is what keeps a
      // sibling destination of the same kind safe: doing it inside the loop
      // would clear a row this same pass had just written.
      for (const kind of DESTINATION_OUTBOX_KINDS) {
        const scope = { subjectUid: input.submissionId, kind, action: input.phase };
        await deleteUnstartedOutbox(this.db, scope);
        await skipBackoffOutbox(this.db, scope);
      }

      for (const destination of enabled) {
        // Every firing destination is queued, unconditionally. The answers this
        // pass carries are the ones the respondent actually left, and declining
        // to queue them because an older delivery is still on the wire would
        // discard the newer of the two for good.
        const content: DeliveryContent = {
          submissionId: input.submissionId,
          formId: input.formId,
          formName: input.formName,
          accountId: input.accountId,
          sessionId: input.sessionId,
          score: input.score,
          outcomeLabel: input.outcomeLabel,
          phase: input.phase,
          data: input.data,
          utm: extractUtm(input.data),
        };
        const ctx: DestinationContext = {
          idempotencyKey: deliveryKeyOf(destination, content),
          ...content,
          submittedAt: input.submittedAt,
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
   *
   * Stands the row down first if a later pass has queued a delivery that
   * replaces it. That question cannot be answered at enqueue time, because the
   * row it would have to cancel may be in a worker's hands; here it can, and
   * this is the last moment before anything crosses the wire.
   */
  /** Returns what crossed the wire, for the queue to record. */
  async deliver(action: string, payloadJson: string): Promise<DeliveryTranscript> {
    const { destination, ctx } = JSON.parse(payloadJson) as DestinationOutboxPayload;
    if (await this.isSuperseded(action, destination, ctx)) {
      this.log.log(
        `destination ${destination.type} (${ctx.submissionId}/${action}) superseded, not delivered`,
      );
      throw new OutboxSkipError(SUPERSEDED_REASON);
    }
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

  /**
   * Has a later pass replaced this delivery?
   *
   * Only rows for the SAME DESTINATION count. Two webhooks on one form are two
   * different deliveries, and letting one answer for the other would mean
   * whichever was queued last silently cancelled its sibling. The destination
   * half of the key is exactly that test, so the comparison is between rows
   * that already agree on where they are going and differ only in what they
   * carry.
   *
   * LATER MEANS A LATER CLOCK READING, STRICTLY. The rows carrying this exact
   * key are this delivery, however many of them there are; anything else under
   * the same destination is a rival. This row stands down only when the newest
   * rival was queued strictly after the newest copy of itself. Equal timestamps
   * are not evidence of order: two passes of one session land on the same
   * millisecond often enough, and there is nothing else to appeal to, because
   * the row id is a random UUID and ranking by it would pick the survivor by
   * coin toss and drop a real delivery. A tie therefore retires nothing and
   * both rows go out, each under its own key, which is precisely the case
   * at-least-once delivery and receiver-side de-duplication exist to absorb.
   *
   * Every no is a delivery that happens, so every unreadable row is a no: a
   * payload that will not parse, or a key from before this shape existed, names
   * no destination this can compare against and therefore supersedes nothing.
   * The alternative, treating an unknown row as possibly newer, would let one
   * unreadable payload silently stop a form from delivering at all. For the
   * same reason a row whose OWN key is unreadable is delivered rather than
   * guessed about, and so is one that finds no copy of itself still queued.
   */
  private async isSuperseded(
    action: string,
    destination: FormDestination,
    ctx: DestinationContext,
  ): Promise<boolean> {
    const mine = parseDeliveryKey(ctx.idempotencyKey);
    if (!mine) return false;
    const queued = await listPendingOutbox(this.db, {
      subjectUid: ctx.submissionId,
      kind: destination.type,
      action,
    });
    let ownNewest: number | null = null;
    let rivalNewest: number | null = null;
    for (const row of queued) {
      const key = idempotencyKeyOf(row.payload);
      const parsed = parseDeliveryKey(key);
      if (!parsed || parsed.destination !== mine.destination) continue;
      if (key === ctx.idempotencyKey) {
        ownNewest = ownNewest === null ? row.createdAt : Math.max(ownNewest, row.createdAt);
      } else {
        rivalNewest = rivalNewest === null ? row.createdAt : Math.max(rivalNewest, row.createdAt);
      }
    }
    if (ownNewest === null || rivalNewest === null) return false;
    return rivalNewest > ownNewest;
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

/**
 * The delivery a queued row names, or null when it names none.
 *
 * Null is the safe answer and has to be. A payload that will not parse, or that
 * carries no key, vouches for no particular delivery, and reading it as one
 * would let a single unreadable row retire work it says nothing about.
 */
function idempotencyKeyOf(payload: string | null): string | null {
  if (!payload) return null;
  try {
    const parsed = JSON.parse(payload) as { ctx?: { idempotencyKey?: unknown } };
    const key = parsed.ctx?.idempotencyKey;
    return typeof key === 'string' && key !== '' ? key : null;
  } catch {
    return null;
  }
}

// --- The delivery key --------------------------------------------------------

/**
 * JSON with exactly one spelling per value: object keys sorted at every depth.
 *
 * A digest is only an identity if equal inputs digest equally, and two configs
 * that differ only in the order a key was typed in are the same config. Arrays
 * keep their order, because an array's order is content. `undefined` members are
 * dropped rather than rendered, so an absent field and a field set to nothing
 * cannot digest differently.
 */
function canonicalJson(value: unknown): string {
  const canonical = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(canonical);
    if (v !== null && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(v as Record<string, unknown>).sort()) {
        const member = (v as Record<string, unknown>)[key];
        if (member === undefined) continue;
        out[key] = canonical(member);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(canonical(value)) ?? 'null';
}

const sha256Hex = (input: string): string => createHash('sha256').update(input, 'utf8').digest('hex');

/**
 * Nothing left over.
 *
 * Assigning a destructuring rest to this compiles only while the rest is empty,
 * so every field the schema persists has to be NAMED in the destructuring above
 * it. That is the whole enforcement: add a field to a destination in
 * `@quill/types` and this file stops compiling until somebody decides, in
 * writing, whether the new field belongs to the destination's identity. Without
 * it a new field is silently absent from the digest, which is the failure mode
 * that matters — two destinations that now differ would keep colliding on one
 * key, and one would retire the other's deliveries.
 */
type NothingLeftOver = Record<PropertyKey, never>;

/**
 * WHERE a webhook delivery is going, as an explicit allowlist.
 *
 * INCLUDED: the minted id when there is one and only then the URL (the id
 * survives an endpoint move, which is what makes it the better name; a legacy
 * destination has none, and then the endpoint is all there is to go on), the
 * signature header, and the phases it subscribes to.
 *
 * EXCLUDED, each on purpose:
 *   enabled    only enabled destinations are ever queued, and switching one off
 *              and on again does not make it a different destination.
 *   secret     NEVER. The key is forwarded to the receiver as a header, so
 *              anything digested into it is published, and a hash of a secret
 *              is an offline oracle for guessing it. Rotating a secret is also
 *              simply not a new delivery.
 *   timeoutMs  a transport parameter. It changes how long we wait, not where
 *              the request goes or what is in it.
 */
function webhookIdentity(destination: WebhookDestination): unknown {
  const { type, id, enabled, events, settings, ...unhandled } = destination;
  const { url, secret, signatureHeader, timeoutMs, ...unhandledSettings } = settings;
  const destinationIsExhaustive: NothingLeftOver = unhandled;
  const settingsAreExhaustive: NothingLeftOver = unhandledSettings;
  void destinationIsExhaustive;
  void settingsAreExhaustive;
  void enabled;
  void secret;
  void timeoutMs;
  return {
    type,
    ref: id ?? url,
    signatureHeader: signatureHeader ?? null,
    events: events ?? null,
  };
}

/**
 * WHERE a HubSpot delivery is going, as an explicit allowlist.
 *
 * HubSpot keeps no secret in the form config (the private-app token is server
 * side), so everything the form persists about what this destination writes is
 * part of what it IS: two entries differing only in a property mapping are two
 * different deliveries. `enabled` is excluded for the same reason as a
 * webhook's. The composite fields go in whole rather than field by field, so a
 * property added inside one is included automatically rather than silently
 * dropped; the guard below covers the levels that ARE taken apart.
 */
function hubspotIdentity(destination: HubspotDestination): unknown {
  const {
    type,
    enabled,
    settings,
    fieldMappings,
    utmMappings,
    valueMaps,
    staticProperties,
    scoreProperty,
    dateProperty,
    outcomeProperty,
    inferCompanyFromEmail,
    bookingSync,
    ...unhandled
  } = destination;
  const { note, formGuid, formActivity, formSignature, ...unhandledSettings } = settings;
  const destinationIsExhaustive: NothingLeftOver = unhandled;
  const settingsAreExhaustive: NothingLeftOver = unhandledSettings;
  void destinationIsExhaustive;
  void settingsAreExhaustive;
  void enabled;
  return {
    type,
    note: note ?? null,
    formGuid: formGuid ?? null,
    formActivity: formActivity ?? null,
    formSignature: formSignature ?? null,
    fieldMappings: fieldMappings ?? null,
    utmMappings: utmMappings ?? null,
    valueMaps: valueMaps ?? null,
    staticProperties: staticProperties ?? null,
    scoreProperty: scoreProperty ?? null,
    dateProperty: dateProperty ?? null,
    outcomeProperty: outcomeProperty ?? null,
    inferCompanyFromEmail: inferCompanyFromEmail ?? null,
    bookingSync: bookingSync ?? null,
  };
}

/**
 * WHERE a delivery is going, as an explicit allowlist of the destination's
 * persisted semantics.
 *
 * An allowlist, not a subtraction, and that direction is the point: the key is
 * forwarded to the receiver as a header, so everything digested into it is
 * PUBLISHED, and a field added to the config schema later must not find its way
 * in here by default. The two helpers make that a compile-time obligation
 * rather than a convention somebody has to remember.
 */
function destinationIdentity(destination: FormDestination): unknown {
  return destination.type === 'webhook'
    ? webhookIdentity(destination)
    : hubspotIdentity(destination);
}

/** The literal that opens every submission delivery key. */
const DELIVERY_KEY_PREFIX = 'submission';
/** A full SHA-256, lower-case hex. Anything shorter is a different scheme. */
const DIGEST_SHAPE = /^[0-9a-f]{64}$/;

/**
 * The stable name of one delivery:
 * `submission:<id>:<phase>:<type>:<destination digest>:<content digest>`.
 *
 * The readable half is what a person debugging needs; the two digests are what
 * make it an identity. Equal keys mean the same answers going to the same
 * destination, which is exactly the promise a receiver deduping on the header
 * we send it is entitled to rely on, and the promise the positional key it
 * replaced could not keep: delete the first of two webhooks and the second
 * inherited its index, and with it its key.
 */
function deliveryKeyOf(destination: FormDestination, content: DeliveryContent): string {
  return [
    DELIVERY_KEY_PREFIX,
    content.submissionId,
    content.phase,
    destination.type,
    sha256Hex(canonicalJson(destinationIdentity(destination))),
    sha256Hex(canonicalJson(content)),
  ].join(':');
}

/** The two halves a key names, once it is known to be one of ours. */
interface DeliveryKey {
  /** Digest of the destination: whether two rows deliver to the SAME place. */
  destination: string;
  /** Digest of the delivery context: whether they carry the same thing. */
  content: string;
}

/**
 * Read a key, or refuse it.
 *
 * Strict on purpose, because the only caller uses the answer to decide whether
 * a delivery still happens. Every segment is checked — the count, the prefix,
 * the phase, a destination type the contract names, and two FULL digests — so
 * that a key from the positional scheme, a hand-written string, or anything
 * else that merely starts with `submission:` cannot pass itself off as one of
 * ours and retire a real delivery.
 */
function parseDeliveryKey(key: string | null): DeliveryKey | null {
  if (!key) return null;
  const parts = key.split(':');
  if (parts.length !== 6) return null;
  const [prefix, submissionId, phase, type, destination, content] = parts as [
    string, string, string, string, string, string,
  ];
  if (prefix !== DELIVERY_KEY_PREFIX || submissionId === '') return null;
  if (phase !== 'partial' && phase !== 'complete') return null;
  if (!(destinationType as readonly string[]).includes(type)) return null;
  if (!DIGEST_SHAPE.test(destination) || !DIGEST_SHAPE.test(content)) return null;
  return { destination, content };
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
