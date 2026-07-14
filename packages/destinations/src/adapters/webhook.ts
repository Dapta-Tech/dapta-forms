import { createHmac } from 'node:crypto';
import type {
  DestinationContext,
  DestinationResult,
  SubmissionDestination,
} from '../destination.port';
import { assertPublicWebhookUrl, type DnsResolver } from '../ssrf-guard';

/** The default header carrying the HMAC signature (overridable per destination). */
export const DEFAULT_SIGNATURE_HEADER = 'X-Forms-Signature';
/** The default per-request timeout. */
export const DEFAULT_WEBHOOK_TIMEOUT_MS = 10_000;
/** The event name carried in the payload + the X-Forms-Event header. */
export const WEBHOOK_EVENT = 'form.submission';

export interface WebhookDestinationOptions {
  /** The customer endpoint to POST each submission to. */
  url: string;
  /** Optional HMAC-SHA256 signing secret. When set, every request is signed. */
  secret?: string;
  /** Header the signature is sent in. Defaults to `X-Forms-Signature`. */
  signatureHeader?: string;
  /** Per-request timeout (ms). Defaults to 10s. A slow endpoint is retried by the outbox. */
  timeoutMs?: number;
  /**
   * Permit loopback destinations (localhost/127.0.0.1/::1). Set only in non-prod
   * (a local webhook catcher). Default false: loopback is rejected as SSRF.
   */
  allowLocalhost?: boolean;
  /** Injectable DNS resolver (tests). Defaults to Node DNS lookup. */
  resolveDns?: DnsResolver;
}

/** The stable JSON envelope POSTed to a webhook destination. */
export interface WebhookPayload {
  /** The idempotency key (also sent as `X-Forms-Delivery`) — de-dup on the receiver. */
  id: string;
  type: typeof WEBHOOK_EVENT;
  phase: 'partial' | 'complete';
  /** ISO-8601 timestamp of the submission phase. */
  submittedAt: string;
  form: { id: string; name: string };
  submission: {
    id: string;
    sessionId: string;
    score: number;
    outcome: string | null;
  };
  data: Record<string, unknown>;
  utm: Record<string, string>;
}

/**
 * Outbound WEBHOOK destination — POSTs a stable JSON envelope of the submission
 * to a customer-configured URL, optionally HMAC-SHA256 signed so the receiver can
 * verify authenticity. No redirects are followed (a 3xx is treated as a failure,
 * so an endpoint can't silently bounce a delivery to an attacker-controlled host)
 * and the request is bounded by a timeout. A non-2xx response, a redirect, a
 * timeout, or a network error THROWS so the durable outbox worker retries with
 * backoff — a delivery is never silently dropped.
 */
export class WebhookDestination implements SubmissionDestination {
  readonly type = 'webhook' as const;

  constructor(
    private readonly opts: WebhookDestinationOptions,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** Build the signed request body exactly as it is sent (exported shape for tests). */
  buildPayload(ctx: DestinationContext): WebhookPayload {
    return {
      id: ctx.idempotencyKey,
      type: WEBHOOK_EVENT,
      phase: ctx.phase,
      submittedAt: new Date(ctx.submittedAt).toISOString(),
      form: { id: ctx.formId, name: ctx.formName },
      submission: {
        id: ctx.submissionId,
        sessionId: ctx.sessionId,
        score: ctx.score,
        outcome: ctx.outcomeLabel,
      },
      data: ctx.data,
      utm: ctx.utm,
    };
  }

  async deliver(ctx: DestinationContext): Promise<DestinationResult> {
    // SSRF guard (H1): resolve the host and reject private/loopback/link-local/
    // metadata targets BEFORE any request is made. Throwing surfaces to the
    // outbox as a (bounded-retry) failure — a blocked URL is never POSTed to.
    await assertPublicWebhookUrl(this.opts.url, {
      allowLocalhost: this.opts.allowLocalhost ?? false,
      resolve: this.opts.resolveDns,
    });

    const body = JSON.stringify(this.buildPayload(ctx));
    const timestamp = String(Math.floor(ctx.submittedAt / 1000));
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-forms-event': WEBHOOK_EVENT,
      'x-forms-delivery': ctx.idempotencyKey,
      'x-forms-timestamp': timestamp,
    };
    if (this.opts.secret) {
      const header = this.opts.signatureHeader || DEFAULT_SIGNATURE_HEADER;
      headers[header.toLowerCase()] = signWebhookBody(body, this.opts.secret);
    }

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.opts.timeoutMs ?? DEFAULT_WEBHOOK_TIMEOUT_MS,
    );
    let res: Response;
    try {
      res = await this.fetchImpl(this.opts.url, {
        method: 'POST',
        headers,
        body,
        redirect: 'manual',
        signal: controller.signal,
      });
    } catch (err) {
      // Timeout (abort) or network error — surface so the outbox retries.
      throw err instanceof Error ? err : new Error(`webhook delivery failed: ${String(err)}`);
    } finally {
      clearTimeout(timeout);
    }
    // No redirects: a 3xx (or the opaque redirect fetch surfaces as status 0)
    // is a failure, never a followed hop.
    if (res.status === 0 || (res.status >= 300 && res.status < 400)) {
      throw new Error(`webhook delivery refused: endpoint attempted a redirect (HTTP ${res.status})`);
    }
    if (!res.ok) throw new Error(`webhook delivery failed: HTTP ${res.status}`);
    return { delivered: true, driver: 'webhook' };
  }
}

/**
 * The HMAC-SHA256 signature of the raw request body, prefixed `sha256=` so the
 * scheme is explicit (GitHub-style). Receivers recompute
 * `HMAC-SHA256(secret, rawBody)` and compare in constant time. Exported for
 * direct contract testing.
 */
export function signWebhookBody(body: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}
