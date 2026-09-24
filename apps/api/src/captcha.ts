/**
 * Spam protection: the port a final submit is checked through, and its one
 * adapter today (Cloudflare Turnstile).
 *
 * The browser runs the challenge and hands the API a token; this module asks
 * the provider whether that token is real. The API is the gate, never the web
 * server action alone, because the submissions endpoint is public and callable
 * with curl.
 *
 * Three verdicts, and the difference is what the caller does with the data:
 *
 * - `passed`: the submit goes ahead.
 * - `failed`: the token is bad (invalid, expired, already spent, or minted for
 *   another session, action or host). The caller writes nothing.
 * - `unavailable`: we could not find out (provider down, 5xx, timeout, our own
 *   secret rejected). The caller keeps the answers as a partial, which is never
 *   delivered while protection is on, and asks the respondent to try again.
 *
 * Another provider plugs in behind `CaptchaVerifier` without the service
 * noticing. No provider symbol may leak past this file.
 */
import { Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { captchaSettings, type ServerEnv } from '@quill/config/env';
import { captchaCData } from '@quill/types';

export const TURNSTILE_SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** The action the renderer stamps on its widget; a token for anything else is refused. */
export const CAPTCHA_ACTION = 'submit';

export type CaptchaVerdict =
  | { outcome: 'passed' }
  | { outcome: 'failed'; reason: string }
  | { outcome: 'unavailable'; reason: string };

export interface CaptchaCheck {
  token: string;
  sessionId: string;
  /** The visitor's address as the rate limiter resolved it; sent only when public. */
  remoteIp?: string | null;
}

export interface CaptchaVerifier {
  /** False on a deployment without keys: the check does not exist there. */
  readonly enabled: boolean;
  readonly provider: 'turnstile' | null;
  /** Public by design: the widget cannot run without it. Null when disabled. */
  readonly siteKey: string | null;
  verify(check: CaptchaCheck): Promise<CaptchaVerdict>;
}

/**
 * What every deployment without keys gets. It is never consulted, because
 * `captchaActive` is false wherever this is wired, so no form on such a
 * deployment is ever checked, held or challenged.
 */
export class NoopCaptchaVerifier implements CaptchaVerifier {
  readonly enabled = false;
  readonly provider = null;
  readonly siteKey = null;
  async verify(): Promise<CaptchaVerdict> {
    return { outcome: 'passed' };
  }
}

export interface TurnstileOptions {
  siteKey: string;
  secretKey: string;
  /** The host the widget must have been served on; null skips the check. */
  expectedHostname?: string | null;
  /** Per-attempt ceiling in ms. */
  timeoutMs?: number;
  /** Everything, retry included, must fit in this many ms. */
  budgetMs?: number;
  /** Pause before the single retry. */
  retryDelayMs?: number;
  fetchImpl?: typeof fetch;
}

/** An attempt that ended in an outage worth one more try. */
type Attempt = { final: CaptchaVerdict } | { retryable: string };

/** The least time worth giving a second attempt (capped by the per-attempt timeout). */
const MIN_ATTEMPT_MS = 250;

export class TurnstileVerifier implements CaptchaVerifier {
  readonly enabled = true;
  readonly provider = 'turnstile' as const;
  private readonly log = new Logger('Captcha');

  constructor(private readonly opts: TurnstileOptions) {}

  get siteKey(): string {
    return this.opts.siteKey;
  }

  async verify({ token, sessionId, remoteIp }: CaptchaCheck): Promise<CaptchaVerdict> {
    const timeoutMs = this.opts.timeoutMs ?? 2500;
    const budgetMs = this.opts.budgetMs ?? 4000;
    const started = Date.now();
    const ip = publicRemoteIp(remoteIp);
    // Derived, not random: a transport retry of the SAME submit (the renderer
    // retries a request that timed out on its side but may have landed) must
    // get the same answer from the provider instead of "already spent".
    const body = {
      secret: this.opts.secretKey,
      response: token,
      idempotency_key: idempotencyKeyFor(sessionId, token),
      ...(ip ? { remoteip: ip } : {}),
    };

    // A retry with less time left than this would only time out.
    const floor = Math.min(MIN_ATTEMPT_MS, timeoutMs);
    let reason = 'not attempted';
    for (let attempt = 0; attempt < 2; attempt++) {
      const remaining = budgetMs - (Date.now() - started);
      if (attempt > 0 && remaining < floor) break;
      const result = await this.attempt(body, Math.min(timeoutMs, Math.max(remaining, 1)), sessionId);
      if ('final' in result) return result.final;
      reason = result.retryable;
      if (attempt === 0) await sleep(this.opts.retryDelayMs ?? 150);
    }
    this.log.warn(`challenge check unavailable (${reason})`);
    return { outcome: 'unavailable', reason };
  }

  private async attempt(body: Record<string, string>, timeoutMs: number, sessionId: string): Promise<Attempt> {
    const fetchImpl = this.opts.fetchImpl ?? fetch;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const res = await Promise.race([
        fetchImpl(TURNSTILE_SITEVERIFY_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error('timeout'));
          }, timeoutMs);
        }),
      ]);
      const payload = (await res.json().catch(() => null)) as SiteverifyResponse | null;
      if (!payload || typeof payload.success !== 'boolean') {
        return { retryable: `http ${res.status}` };
      }
      return this.judge(payload, sessionId);
    } catch (err) {
      return { retryable: err instanceof Error && err.message === 'timeout' ? 'timeout' : 'network' };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private judge(payload: SiteverifyResponse, sessionId: string): Attempt {
    const codes = Array.isArray(payload['error-codes']) ? payload['error-codes'] : [];
    if (!payload.success) {
      if (codes.includes('internal-error')) return { retryable: 'internal-error' };
      // Our own configuration, not the respondent: never punish a person for a
      // secret someone mistyped. Loud, because every protected form is now
      // saving partials instead of completes.
      if (codes.some((c) => c === 'invalid-input-secret' || c === 'missing-input-secret' || c === 'bad-request')) {
        this.log.error(`challenge check misconfigured (${codes.join(', ')}): check CAPTCHA_SECRET_KEY`);
        return { final: { outcome: 'unavailable', reason: codes.join(',') } };
      }
      return { final: { outcome: 'failed', reason: codes.join(',') || 'rejected' } };
    }
    // The provider's public TEST keys answer success with no action and no
    // session, for any token; only a test secret can produce this, so a
    // production deployment never takes this branch. Comparing would refuse
    // every test token and make the test keys useless for CI and local runs.
    if (payload.metadata?.result_with_testing_key === true) return { final: { outcome: 'passed' } };
    if (payload.action !== CAPTCHA_ACTION) return { final: { outcome: 'failed', reason: 'action-mismatch' } };
    if (payload.cdata !== captchaCData(sessionId)) return { final: { outcome: 'failed', reason: 'session-mismatch' } };
    const expected = this.opts.expectedHostname;
    if (expected && payload.hostname !== expected) {
      return { final: { outcome: 'failed', reason: 'hostname-mismatch' } };
    }
    return { final: { outcome: 'passed' } };
  }
}

interface SiteverifyResponse {
  success?: unknown;
  'error-codes'?: string[];
  hostname?: string;
  action?: string;
  cdata?: string;
  metadata?: { result_with_testing_key?: boolean };
}

/**
 * The verifier for this deployment: Turnstile when both keys are set and the
 * kill switch is not, the no-op otherwise. The expected token host is the host
 * of `PUBLIC_APP_URL`, which is where the public form (and so the widget) is
 * served, including inside an iframe on a customer's page.
 */
export function createCaptchaVerifier(
  env: ServerEnv,
  opts: { fetchImpl?: typeof fetch } = {},
): CaptchaVerifier {
  const settings = captchaSettings(env);
  if (!settings) return new NoopCaptchaVerifier();
  return new TurnstileVerifier({
    siteKey: settings.siteKey,
    secretKey: settings.secretKey,
    timeoutMs: settings.timeoutMs,
    expectedHostname: hostnameOf(env.PUBLIC_APP_URL),
    fetchImpl: opts.fetchImpl,
  });
}

/** The switch the form owner flipped, read loosely from a stored config. */
function spamProtectionOf(config: unknown): { captcha?: unknown; strict?: unknown } | null {
  if (!config || typeof config !== 'object') return null;
  const sp = (config as { spamProtection?: unknown }).spamProtection;
  return sp && typeof sp === 'object' ? (sp as { captcha?: unknown; strict?: unknown }) : null;
}

/**
 * Whether a published form is checked on THIS deployment: its owner turned the
 * check on AND the deployment has keys. Everything the feature changes (the
 * challenge, the held partials, the booking guard) keys off this one answer,
 * so a form saved with the switch on behaves exactly as before on a deployment
 * that cannot run it.
 */
export function captchaActive(config: unknown, verifier: CaptchaVerifier | null | undefined): boolean {
  return verifier?.enabled === true && spamProtectionOf(config)?.captcha === true;
}

/** Strict mode: only meaningful while the check itself is active. */
export function captchaStrict(config: unknown, verifier: CaptchaVerifier | null | undefined): boolean {
  return captchaActive(config, verifier) && spamProtectionOf(config)?.strict === true;
}

/**
 * A UUID for the provider's idempotency key, derived from the session and the
 * token so a retry of the same submit repeats it exactly. Shaped as a v4 UUID
 * (version and variant bits set) because the key is checked as one.
 */
export function idempotencyKeyFor(sessionId: string, token: string): string {
  const hex = createHash('sha256').update(`${sessionId}:${token}`).digest('hex').slice(0, 32).split('');
  hex[12] = '4';
  hex[16] = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  const h = hex.join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/**
 * The visitor's address when it can actually be theirs, else undefined. A
 * loopback, private or link-local address is one of our own hops (the web
 * server, a pod, a proxy), and sending it as the visitor's would only give the
 * provider a reason to distrust a real person.
 */
export function publicRemoteIp(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const ip = raw.startsWith('::ffff:') && isIP(raw.slice(7)) === 4 ? raw.slice(7) : raw;
  const family = isIP(ip);
  if (family === 4) {
    const [a, b] = ip.split('.').map(Number) as [number, number];
    if (a === 10 || a === 127 || a === 0) return undefined;
    if (a === 172 && b >= 16 && b <= 31) return undefined;
    if (a === 192 && b === 168) return undefined;
    if (a === 169 && b === 254) return undefined;
    if (a === 100 && b >= 64 && b <= 127) return undefined;
    return ip;
  }
  if (family === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return undefined;
    if (/^f[cd]/.test(lower)) return undefined; // unique local fc00::/7
    if (/^fe[89ab]/.test(lower)) return undefined; // link local fe80::/10
    return ip;
  }
  return undefined;
}

function hostnameOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
