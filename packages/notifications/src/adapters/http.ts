import { createHash, createHmac } from 'node:crypto';
import type { EmailAttachment, EmailMessage, EmailProvider, EmailResult } from '../email.port';
import { normalizeRecipients } from '../util';

/**
 * Which HTTP wire to speak:
 *   - `generic` (default): the original provider-agnostic payload + optional
 *     Bearer auth. Unchanged — any managed endpoint wired via config keeps
 *     working exactly as before.
 *   - `transactional-v1`: the managed transactional-email contract (mode,
 *     to[], replyTo, subject, html/text, category, idempotencyKey, and
 *     base64 attachments), authenticated with a timestamped HMAC signature.
 */
export type HttpWireProfile = 'generic' | 'transactional-v1';

/** Default category for the transactional-v1 profile (Req 5). */
export const DEFAULT_TRANSACTIONAL_CATEGORY = 'lifecycle';
export const TRANSACTIONAL_EMAIL_PATH = '/api/internal/email/send';

export interface HttpEmailOptions {
  /** The email-service endpoint to POST the message to. */
  endpoint: string;
  /** Wire/profile to speak. Defaults to `generic` for backwards compatibility. */
  profile?: HttpWireProfile;
  /** Optional Bearer token — `generic` profile only. */
  token?: string;
  /** Stable service identity used for scoped authorization. */
  clientId?: string;
  /** HMAC secret loaded only from the runtime secret manager. Never transmitted or logged. */
  signingSecret?: string;
  /**
   * DEPRECATED static service key — Bearer fallback for the transactional wire
   * when the HMAC pair is not configured, so legacy deployments keep sending
   * after an upgrade. Remove once every environment carries clientId+secret.
   */
  apiKey?: string;
  /** Message category for `transactional-v1` (defaults to `lifecycle`). */
  category?: string;
  fromEmail: string;
  fromName?: string;
}

/**
 * HTTP mailer adapter — POSTs a submission email to an external email service and
 * treats a successful dispatch as delivered. The concrete endpoint + auth live
 * outside the public repo, in deployment config; no provider is hardcoded here.
 *
 * Two profiles share this adapter (selected by config):
 *   - `generic` POSTs a provider-agnostic JSON body and treats any 2xx as
 *     delivered (the original behavior — preserved as the default).
 *   - `transactional-v1` POSTs the managed transactional contract and reads the
 *     JSON response: `accepted`/`delivered` and valid idempotent duplicates
 *     count as dispatched; `blocked_by_policy` or a malformed 2xx body THROW so
 *     the durable outbox retries instead of silently dropping the mail.
 *
 * A non-2xx response or a network error THROWS (the durable outbox worker
 * catches it and retries — B1/DM1); failures are never swallowed to
 * `delivered:false`, which would look like success and silently drop the mail.
 */
export class HttpEmailProvider implements EmailProvider {
  /** The signed wire scopes messages by tenant — deliveries need an accountId. */
  readonly requiresAccountContext: boolean;

  constructor(
    private readonly opts: HttpEmailOptions,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.requiresAccountContext = opts.profile === 'transactional-v1';
    if (opts.profile === 'transactional-v1') {
      // A surprising endpoint path is a config smell worth a WARN — but config
      // detail must never crash-loop the API (the deployment may front the
      // service with a gateway prefix or a rewrite).
      warnOnNonCanonicalEndpoint(opts.endpoint);
    }
  }

  async send(message: EmailMessage): Promise<EmailResult> {
    const to = normalizeRecipients(message.to);
    if (this.opts.profile === 'transactional-v1') return this.sendTransactional(message, to);
    return this.sendGeneric(message, to);
  }

  /** The original generic wire — payload + auth unchanged. */
  private async sendGeneric(message: EmailMessage, to: string[]): Promise<EmailResult> {
    const payload = {
      from: message.from ?? this.opts.fromEmail,
      fromName: this.opts.fromName,
      to,
      replyTo: message.replyTo,
      subject: message.subject,
      html: message.html,
      text: message.text,
      headers: message.headers,
      attachments: message.attachments?.map((a) => ({
        filename: a.filename,
        content: typeof a.content === 'string' ? a.content : a.content.toString('base64'),
        encoding: typeof a.content === 'string' ? undefined : 'base64',
        contentType: a.contentType,
      })),
    };
    try {
      const res = await this.fetchImpl(this.opts.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.opts.token ? { authorization: `Bearer ${this.opts.token}` } : {}),
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`http mailer failed: HTTP ${res.status}`);
      const body = (await res.json().catch(() => ({}))) as { messageId?: string };
      return { delivered: true, messageId: body.messageId, driver: 'http' };
    } catch (err) {
      // Surface the failure so the outbox worker retries (never a silent drop).
      throw err instanceof Error ? err : new Error(`http mailer failed: ${String(err)}`);
    }
  }

  /**
   * The managed transactional-v1 contract. Sends ONLY the supported fields — no
   * `from`/`fromName`/`headers` (the managed service owns the sender identity) —
   * and reads the JSON response to decide dispatched-vs-throw.
   */
  private async sendTransactional(message: EmailMessage, to: string[]): Promise<EmailResult> {
    if (!message.accountId) {
      throw new Error('transactional email requires an authenticated account context');
    }
    const hasHtml = typeof message.html === 'string' && message.html.length > 0;
    const payload: Record<string, unknown> = {
      mode: hasHtml ? 'html' : 'text',
      to,
      replyTo: message.replyTo,
      subject: message.subject,
      category: this.opts.category ?? DEFAULT_TRANSACTIONAL_CATEGORY,
      idempotencyKey: message.idempotencyKey,
      businessContext: { accountId: message.accountId },
      attachments: message.attachments?.map(toTransactionalAttachment),
    };
    if (hasHtml) payload.html = message.html;
    if (typeof message.text === 'string' && message.text.length > 0) payload.text = message.text;

    const requestBody = JSON.stringify(payload);
    let authHeaders: Record<string, string>;
    if (this.opts.clientId && this.opts.signingSecret) {
      const timestamp = String(Math.floor(Date.now() / 1000));
      authHeaders = {
        'x-dapta-client-id': this.opts.clientId,
        'x-dapta-timestamp': timestamp,
        'x-dapta-signature': signTransactionalRequest(
          requestBody,
          timestamp,
          message.idempotencyKey ?? '',
          this.opts.signingSecret,
        ),
      };
    } else if (this.opts.apiKey || this.opts.token) {
      // DEPRECATED legacy fallback: static service key as Bearer, so a
      // deployment upgraded before rotating to the HMAC pair keeps sending.
      authHeaders = { authorization: `Bearer ${this.opts.apiKey || this.opts.token}` };
    } else {
      // A SEND-time failure the outbox records and retries — never a boot throw.
      throw new Error('transactional email service authentication is not configured');
    }

    let res: Response;
    try {
      res = await this.fetchImpl(this.opts.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...authHeaders,
        },
        body: requestBody,
      });
    } catch (err) {
      // Network/transport error — surface so the outbox worker retries.
      throw err instanceof Error ? err : new Error(`transactional email failed: ${String(err)}`);
    }
    const body = await res.json().catch(() => null);
    return interpretTransactionalResponse(res.status, body);
  }
}

/**
 * The canonical string deliberately pins the LOGICAL path constant, NOT the
 * actual request path. The dapta-email verifier builds its canonical string
 * the same way — a hardcoded `SIGNED_PATH = "/api/internal/email/send"`
 * (email-service-auth.service.ts, `buildEmailServiceSignaturePayload`) — so
 * both sides stay in agreement no matter what gateway prefix or rewrite the
 * transport applies to the URL. Signing the observed request path would BREAK
 * verification behind any prefixing proxy, which is exactly the deployment
 * shape the endpoint WARN (vs the old assert) now permits.
 */
export function signTransactionalRequest(
  body: string,
  timestamp: string,
  idempotencyKey: string,
  secret: string,
): string {
  const bodyHash = createHash('sha256').update(body).digest('hex');
  const canonical = [
    'v1',
    'POST',
    TRANSACTIONAL_EMAIL_PATH,
    timestamp,
    idempotencyKey,
    bodyHash,
  ].join('\n');
  return createHmac('sha256', secret).update(canonical).digest('hex');
}

function warnOnNonCanonicalEndpoint(endpoint: string): void {
  try {
    const url = new URL(endpoint);
    if (!url.pathname.endsWith(TRANSACTIONAL_EMAIL_PATH) || url.search || url.hash) {
      console.warn(
        `[email:http] transactional endpoint "${url.pathname}${url.search}${url.hash}" does not ` +
          `end with the canonical ${TRANSACTIONAL_EMAIL_PATH} — sending anyway; verify the config.`,
      );
    }
  } catch {
    console.warn(`[email:http] transactional endpoint is not a valid URL — sends will fail until fixed.`);
  }
}

/** Map an EmailAttachment to the managed transactional attachment object. */
function toTransactionalAttachment(a: EmailAttachment) {
  const contentBase64 =
    typeof a.content === 'string'
      ? Buffer.from(a.content, 'utf8').toString('base64')
      : a.content.toString('base64');
  return {
    filename: a.filename,
    contentType: a.contentType,
    contentBase64,
    disposition: 'attachment' as const,
  };
}

/** The managed response fields this consumer reads. */
interface TransactionalResponseBody {
  status?: string;
  messageId?: string;
  id?: string;
  /** Informational — set alongside status `accepted`/`delivered` on an idempotent replay. */
  duplicate?: boolean;
  blockedReason?: string;
}

/**
 * Interpret a transactional-v1 response into a dispatched result, or THROW so
 * the durable outbox retries / records the failure — never a silent drop (Req 6).
 *
 * A non-2xx response is a failure REGARDLESS of body (enforced first). On a 2xx:
 *   - `accepted` / `delivered`          → dispatched (a valid idempotent
 *                                          duplicate arrives as accepted/delivered
 *                                          with `duplicate:true` — still dispatched)
 *   - `blocked_by_policy`               → throw (a real, non-retryable refusal,
 *                                          surfaced so it lands in the outbox log)
 *   - any other / missing status        → throw (malformed — do not assume
 *                                          success)
 *
 * Exported for direct contract testing.
 */
export function interpretTransactionalResponse(
  httpStatus: number,
  body: unknown,
): EmailResult {
  // Non-2xx is a transport failure — never interpret a body status past it.
  if (httpStatus < 200 || httpStatus >= 300) {
    throw new Error(`transactional email failed: HTTP ${httpStatus}`);
  }

  const b = (body ?? {}) as TransactionalResponseBody;
  const status = typeof b.status === 'string' ? b.status : undefined;
  const messageId = b.messageId ?? b.id;

  // accepted/delivered is the sole success criterion (idempotent duplicates come
  // through here with `duplicate:true` — still a real dispatch).
  if (status === 'accepted' || status === 'delivered') {
    return { delivered: true, messageId, driver: 'http' };
  }
  if (status === 'blocked_by_policy') {
    throw new Error(
      `transactional email blocked by policy${b.blockedReason ? `: ${b.blockedReason}` : ''}`,
    );
  }
  if (status) {
    throw new Error(`transactional email returned unexpected status: ${status}`);
  }
  // 2xx but no status field — a malformed success. Do not silently drop.
  throw new Error('transactional email returned a malformed response (no status)');
}
