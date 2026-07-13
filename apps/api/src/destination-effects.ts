import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { deletePendingOutbox, enqueueOutbox, type Db, type OutboxKind } from '@quill/db';
import {
  createDestination,
  type DestinationContext,
  type DestinationSpec,
} from '@quill/destinations';
import { formConfigSchema, formDestinationSchema, type FormDestination } from '@quill/types';
import type { ServerEnv } from '@quill/config/env';
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
      for (const destination of destinations) {
        if (destination.enabled === false) continue;
        const kind = destination.type as OutboxKind;
        const idempotencyKey = `submission:${input.submissionId}:${input.phase}:${destination.type}`;
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
        // A re-submit of the same session+phase replaces a not-yet-sent delivery.
        await deletePendingOutbox(this.db, {
          subjectUid: input.submissionId,
          kind,
          action: input.phase,
        });
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
   * The worker's executor for a destination outbox row (kind webhook/hubspot).
   * Rebuilds the destination (injecting the server-side HubSpot token at delivery
   * time — it is never stored in the payload) and delivers. A THROWN transport
   * error propagates so the worker retries; a permanent no-op (delivered:false)
   * resolves so the row is marked done.
   */
  async deliver(action: string, payloadJson: string): Promise<void> {
    const { destination, ctx } = JSON.parse(payloadJson) as DestinationOutboxPayload;
    const spec = this.toSpec(destination);
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
  }

  /** Resolve a stored destination config into a delivery spec (inject secrets). */
  private toSpec(destination: FormDestination): DestinationSpec {
    if (destination.type === 'webhook') {
      return {
        type: 'webhook',
        webhook: {
          url: destination.settings.url,
          secret: destination.settings.secret ?? undefined,
          signatureHeader: destination.settings.signatureHeader ?? undefined,
          timeoutMs: destination.settings.timeoutMs,
        },
      };
    }
    return {
      type: 'hubspot',
      hubspot: {
        // Server-side secret, injected at delivery time — never persisted.
        token: this.env?.HUBSPOT_PRIVATE_APP_TOKEN ?? '',
        fieldMappings: destination.fieldMappings ?? {},
        utmMappings: destination.utmMappings ?? {},
        scoreProperty: destination.scoreProperty ?? undefined,
        dateProperty: destination.dateProperty ?? undefined,
        note: destination.settings?.note,
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
function extractUtm(data: Record<string, unknown>): Record<string, string> {
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
