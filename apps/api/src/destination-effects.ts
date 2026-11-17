import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  deletePendingOutbox,
  enqueueOutbox,
  resolveProviderToken,
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
  destinationIsDeliverable,
  writableSheetColumns,
  formConfigSchema,
  formDestinationSchema,
  type FormDestination,
  type SubmissionVisit,
} from '@quill/types';
import type { ServerEnv } from '@quill/config/env';
import { OutboxSkipError } from './email-effects';
import { fileLinksFor } from './file-link';
import { GoogleSheetsAccessTokens } from './google-sheets-token';
import { SalesforceAccessTokens } from './salesforce-auth';
import { SalesforceFieldsService } from './salesforce-fields';
import { HubspotPortalResolver, mirrorGuidFor } from './hubspot-portal';
import { HubspotPropertiesService } from './integrations.controller';
import { destinationUsesHutk, withoutHutk } from './submission-visit';
import { DB, ENV } from './tokens';

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
  /**
   * The page it was answered on, from the MERGED row (see `upsertSubmission`).
   * Snapshotted into the payload with the rest, so a retry delivers the same one.
   */
  visit?: SubmissionVisit | null;
  /** The form's public title, snapshotted with a visit (see `DestinationContext.formTitle`). */
  formTitle?: string;
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
    /** Portal property types (cached per account) — resolves whether the
     *  submitted-date target keeps the instant (`datetime`) or only a day
     *  (`date`). Optional: absent = unknown, the adapter day-collapses. */
    @Optional()
    @Inject(HubspotPropertiesService)
    private readonly hubspotProperties?: HubspotPropertiesService,
    /**
     * accountId -> a live Google access token, minted from its refresh token.
     * Shared with the controller so a disconnect clears the one cache both
     * sides read; optional because the specs build this class positionally,
     * and a Google Sheets destination with no token degrades to log-only.
     */
    @Optional()
    @Inject(GoogleSheetsAccessTokens)
    private readonly googleTokens: GoogleSheetsAccessTokens = new GoogleSheetsAccessTokens(),
    /** Shared with the controller for the same reason as `googleTokens`. */
    @Optional()
    @Inject(SalesforceAccessTokens)
    private readonly salesforceTokens: SalesforceAccessTokens = new SalesforceAccessTokens(),
    /** Field types per account (a number goes as a number, a date as a day). */
    @Optional()
    @Inject(SalesforceFieldsService)
    private readonly salesforceFields?: SalesforceFieldsService,
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
        // A destination stored mid-setup (a spreadsheet card switched on with
        // no spreadsheet or no complete column yet) is skipped here, not
        // handed to an adapter that could only log a no-op per submission.
        .filter(({ destination }) => destinationIsDeliverable(destination))
        // Per-event trigger filter: a destination with an `events` list only fires
        // for the phases it names (webhook `events:['complete']` skips partials, and
        // vice versa). Absent/empty `events` fires on BOTH phases (back-compat), and
        // destinations without the field (e.g. HubSpot) always pass — the helper
        // returns true. Mapping happens BEFORE this filter so the idempotency key
        // keeps each destination's ORIGINAL config-array index.
        .filter(({ destination }) => destinationFiresForPhase(destination, input.phase));

      // A re-submit of the same session+phase replaces every not-yet-sent
      // delivery: cancel pending rows ONCE per kind BEFORE the enqueue loop.
      // Deleting inside the loop would cancel a sibling destination of the same
      // type that was just enqueued (two webhooks are legal — only the last one
      // would ever deliver).
      const kinds = new Set<OutboxKind>(
        enabled.map(({ destination }): OutboxKind => destination.type),
      );
      for (const kind of kinds) {
        await deletePendingOutbox(this.db, {
          subjectUid: input.submissionId,
          kind,
          action: input.phase,
        });
      }

      // One permanent link per uploaded file, for the webhook payload only.
      // Minted once here and snapshotted with the rest, so a retry sends the
      // same link, and kept OUT of `data`: HubSpot reads `data` and must see
      // exactly what was stored, and so must the submission row itself.
      const fileLinks = enabled.some(({ destination }) => destination.type === 'webhook')
        ? fileLinksFor(this.env, input.submissionId, input.data)
        : undefined;

      for (const { destination, index } of enabled) {
        // No cast, on purpose: a destination type that is not an outbox kind
        // must fail to COMPILE. With `as OutboxKind` here, Google Sheets was
        // enqueued under a kind the worker did not know, and every delivery
        // was retried five times and marked failed.
        const kind: OutboxKind = destination.type;
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
          ...(fileLinks && destination.type === 'webhook' ? { fileLinks } : {}),
          // Only when there is one: without it the payload is byte for byte
          // what it was before the visit existed. The cookie goes only into
          // the snapshot of a destination that sends it on in this phase.
          ...(input.visit
            ? {
                visit: destinationUsesHutk(destination, input.phase) ? input.visit : withoutHutk(input.visit),
                ...(input.formTitle ? { formTitle: input.formTitle } : {}),
              }
            : {}),
        };
        const payload: DestinationOutboxPayload = { destination, ctx };
        await enqueueOutbox(this.db, {
          kind,
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
   * The worker's executor for a destination outbox row (every destination kind).
   * Rebuilds the destination (injecting the server-side token at delivery time,
   * never stored in the payload) and delivers. Returns what crossed the wire,
   * for the queue to record on the `done` row.
   *
   * Three outcomes, one per settlement:
   *   - delivered: returns, and the row is marked `done`;
   *   - THROWN transport error: propagates, and the worker retries;
   *   - `delivered:false`, a permanent refusal or a no-op the adapter resolved
   *     (Salesforce answering 400, a sheet that is gone, no email to key on, a
   *     CRM that is not connected): throws `OutboxSkipError` with the adapter's
   *     reason and transcript, so the row ends `skipped`, is never retried, and
   *     is never shown as delivered. It used to return like a success, and the
   *     history told the author a lead had arrived when the CRM had refused it.
   */
  async deliver(action: string, payloadJson: string): Promise<DeliveryTranscript> {
    const { destination, ctx } = JSON.parse(payloadJson) as DestinationOutboxPayload;
    // ctx.accountId is the form's account — resolve that account's HubSpot token
    // (else the env fallback) at delivery time.
    const spec = await this.toSpec(destination, ctx.accountId);
    const dest = createDestination(spec, this.fetchImpl);
    const result = await dest.deliver(ctx);
    const transcript: DeliveryTranscript = {
      requestBody: result.requestBody,
      responseStatus: result.responseStatus,
      responseBody: result.responseBody,
    };
    if (!result.delivered) {
      // Logged by the worker when it settles the row as skipped.
      throw new OutboxSkipError(
        result.detail?.trim() || `${destination.type} did not accept the delivery (${result.driver})`,
        transcript,
      );
    }
    this.log.log(
      `destination ${destination.type} (${ctx.submissionId}/${action}) delivered` +
        (result.detail ? `: ${result.detail}` : ''),
    );
    return transcript;
  }

  /**
   * The portal-reported type of one property (`date` / `datetime` / …), or
   * undefined when it cannot be known — no property configured, service not
   * wired, no token, or the lookup failed. Undefined makes the adapter fall
   * back to the day-collapse default, the only value a `date` property cannot
   * reject. Backed by the properties service's 5-minute per-account cache, so
   * a delivery burst does not hammer HubSpot.
   */
  private async resolvePropertyType(
    accountId: string,
    property: string | null | undefined,
  ): Promise<string | undefined> {
    const name = property?.trim();
    if (!name) return undefined;
    try {
      const listed = await this.hubspotProperties?.listProperties(accountId);
      if (!listed?.enabled) return undefined;
      return listed.properties.find((p) => p.name === name)?.type;
    } catch {
      return undefined;
    }
  }

  /**
   * Resolve a stored destination config into a delivery spec (inject secrets).
   *
   * A switch rather than the if/else-with-a-tail this used to be: HubSpot was
   * the tail, so a destination type added later would have been handed HubSpot's
   * token and HubSpot's mappings and would have delivered somebody's submission
   * to the wrong place entirely.
   */
  private async toSpec(destination: FormDestination, accountId: string): Promise<DestinationSpec> {
    if (destination.type === 'salesforce') {
      // Minted from the account's Client Credentials at DELIVERY time, cached
      // per account. Null when not connected or the org refused, which the
      // factory turns into a log-only no-op; a Salesforce that did not answer
      // throws here and the outbox retries.
      const access = await this.salesforceTokens.resolve(this.db, accountId, this.env, this.fetchImpl);
      // Field types decide how a value is sent (`25` vs `"25"`, a day vs an
      // instant) and which mappings reach a Contact. Unknown is tolerated (the
      // adapter falls back to strings), but a describe that did not ANSWER
      // throws, so a delivery waits instead of sending numbers as text.
      const types = access ? await this.salesforceFields?.fieldTypes(accountId) : null;
      return {
        type: 'salesforce',
        salesforce: {
          accessToken: access?.accessToken ?? '',
          instanceUrl: access?.instanceUrl ?? '',
          fieldMappings: destination.fieldMappings ?? {},
          utmMappings: destination.utmMappings ?? {},
          scoreField: destination.scoreField ?? undefined,
          dateField: destination.dateField ?? undefined,
          dayTimezone: destination.dayTimezone,
          staticFields: destination.staticFields,
          leadFields: types?.lead,
          contactFields: types?.contact,
          // A 401 means the cached token outlived the org's session: drop it,
          // so the retry the adapter's throw schedules mints a fresh one.
          onUnauthorized: () => this.salesforceTokens.invalidate(accountId),
        },
      };
    }
    if (destination.type === 'google-sheets') {
      // Minted from the account's refresh token at DELIVERY time, cached per
      // account. Empty when the account is not connected or Google refused to
      // renew, which the factory turns into a log-only no-op.
      const accessToken = await this.googleTokens.resolve(
        this.db,
        accountId,
        this.env,
        this.fetchImpl,
      );
      return {
        type: 'google-sheets',
        googleSheets: {
          accessToken,
          spreadsheetId: destination.settings?.spreadsheetId ?? '',
          sheetTitle: destination.settings?.sheetTitle ?? undefined,
          // Only complete columns: the same ones the header row holds, so a
          // column the author is still filling in shifts nothing.
          columns: writableSheetColumns(destination.columns),
        },
      };
    }
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
        datePropertyType: await this.resolvePropertyType(accountId, destination.dateProperty),
        dayTimezone: destination.dayTimezone ?? destination.bookingSync?.dateTimezone,
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
