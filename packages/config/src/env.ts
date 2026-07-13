/**
 * Central environment schema (zod). Validated once at server startup; fails
 * loud on a missing *required* production var, never silently. A bare fork with
 * NOTHING set must still boot — so every var has a safe default that selects the
 * zero-infra path (SQLite, log-only email, local auth).
 *
 * `NEXT_PUBLIC_*` client vars are validated separately (see `clientEnvSchema`)
 * because only they may cross into the browser bundle — a server secret in a
 * client bundle is a leak.
 */
import { z } from 'zod';

/** Coerce common truthy/falsey strings to boolean. */
const boolish = z
  .string()
  .transform((v) => v === 'true' || v === '1' || v === 'yes')
  .pipe(z.boolean());

export const serverEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // Database — unset selects SQLite (zero-infra). `file:` = SQLite, `postgres://` = pg.
  DATABASE_URL: z.string().default('file:./.data/dev.db'),

  // API
  API_PORT: z.coerce.number().int().positive().default(4000),
  PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),

  // Email / notifications
  EMAIL_PROVIDER: z.enum(['log-only', 'noop', 'smtp', 'http']).default('log-only'),
  MAIL_FROM_EMAIL: z.string().default('bookings@example.com'),
  MAIL_FROM_NAME: z.string().default('Calendars'),

  // SMTP adapter
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_SECURE: boolish.optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),

  // HTTP mailer adapter (EMAIL_PROVIDER=http).
  EMAIL_HTTP_ENDPOINT: z.string().url().optional(),
  // Wire/profile: `generic` (default, provider-agnostic body + Bearer auth) or
  // `transactional-v1` (managed transactional contract + HMAC service auth).
  EMAIL_HTTP_PROFILE: z.enum(['generic', 'transactional-v1']).default('generic'),
  // Bearer token — `generic` profile.
  EMAIL_HTTP_TOKEN: z.string().optional(),
  // Stable non-secret service id and server-only HMAC secret. The secret is
  // loaded from the deployment secret manager and is never transmitted.
  EMAIL_HTTP_CLIENT_ID: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/).optional(),
  EMAIL_HTTP_SIGNING_SECRET: z.string().min(32).optional(),
  // DEPRECATED: pre-HMAC static service key. Still read (never-break-env-vars)
  // as a Bearer fallback on the transactional wire; migrate to the pair above.
  EMAIL_HTTP_API_KEY: z.string().optional(),
  // Message category for `transactional-v1` (defaults to `lifecycle`).
  EMAIL_HTTP_CATEGORY: z.string().optional(),

  // Premium features (vanity slug + future perks). Calendars is ALWAYS free —
  // `locked` gates premium on the customer's Dapta AI subscription via the
  // entitlement service below; `open` (default) unlocks everything, so a bare
  // OSS fork gets every feature with no upstream wired.
  PREMIUM_FEATURES: z.enum(['open', 'locked']).default('open'),
  // Upstream entitlement service (cloud only): base URL + service key. Unset
  // selects the disabled provider (OSS default).
  ENTITLEMENTS_API_URL: z.string().url().optional(),
  ENTITLEMENTS_API_KEY: z.string().optional(),

  // Auth — unset selects the local dev stub.
  AUTH_PROVIDER: z.enum(['local', 'workos']).default('local'),

  // DEV ONLY — which host the local stub logs in as. When AUTH_PROVIDER=local
  // and this is set (or an `x-slate-email` header is sent), the stub resolves
  // the member with this email, JIT-creating a fresh account+member if none
  // exists — so a developer lands in THEIR own workspace instead of the first
  // seeded demo account. Ignored in production (the stub refuses to boot there).
  DEV_LOGIN_EMAIL: z.string().optional(),

  // DEV ONLY — when true, the local stub does NOT fall back to the seeded/
  // DEV_LOGIN_EMAIL account: a request with no identity (no impersonation
  // headers, no `x-slate-email`) resolves to 401 UNAUTHENTICATED. This gives
  // local dev a real "logged out" state so a web login/logout flow can bounce
  // to the sign-in screen (mirrors the old app). Default false keeps OSS
  // clone-and-run frictionless (always logged in, zero auth setup).
  AUTH_LOCAL_STRICT: boolish.optional(),

  // Host-session token (validated by the `workos` provider). The dashboard token
  // is an HS256 JWT minted by the upstream identity service (a shared symmetric
  // secret — so the SAME validation runs identically in local dev and remote).
  // All optional here: a bare OSS fork sets nothing and stays on `local`. The
  // provider fails loud if `workos` is selected without JWT_SECRET. Issuer/
  // audience are enforced ONLY when set (leave the vendor's real values to
  // deploy config / a local .env — never hardcoded in this public schema).
  JWT_SECRET: z.string().optional(),
  JWT_ISSUER: z.string().optional(),
  JWT_AUDIENCE: z.string().optional(),

  // Calendar — `disabled` (default) runs with no external calendar: slots
  // subtract only local busy and no events are written out. `external` selects
  // the concrete generic-HTTP adapter (`ExternalCalendarProvider`); selecting it
  // without a backend configured (below) fails loud rather than silent-disabling.
  CALENDAR_PROVIDER: z.enum(['disabled', 'external']).default('disabled'),

  // External calendar backend (only read when CALENDAR_PROVIDER=external). The
  // adapter speaks a generic REST contract to CALENDAR_API_BASE_URL, authorized
  // by a bearer. Two ways to supply the bearer + request shaping:
  //   - Self-host / simple REST backend: set CALENDAR_API_TOKEN (a static bearer)
  //     and the committed GenericRestWire is used.
  //   - Real integration platform: set CALENDAR_BACKEND_MODULE to a PRIVATE
  //     overlay module (gitignored, e.g. under deploy/) that default-exports a
  //     factory `(env) => { baseUrl, tokenSource, wire }` — the JWT authority +
  //     vendor request mapping live there, never in this public build (R15).
  // Base URL / token / module path are all left to deploy config or a local
  // .env — never hardcoded here (same rule as JWT_ISSUER/JWT_AUDIENCE).
  CALENDAR_API_BASE_URL: z.string().url().optional(),
  CALENDAR_API_TOKEN: z.string().optional(),
  CALENDAR_BACKEND_MODULE: z.string().optional(),
  CALENDAR_HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),

  // Outbox worker (B7/DM1): drains durable side-effects (calendar write-out,
  // webhook delivery) with retry+backoff. Enabled by default; the poll interval
  // and retry ceiling are tunable. Set OUTBOX_WORKER_ENABLED=false to run the
  // API without the background drainer (e.g. when a separate worker process owns
  // it). On a bare clone the queue is empty, so the worker just idles.
  OUTBOX_WORKER_ENABLED: boolish.default('true'),
  OUTBOX_POLL_MS: z.coerce.number().int().positive().default(5000),
  OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),

  // CORS: a comma-separated allowlist of origins permitted to call the API from
  // a browser. When UNSET we default to PUBLIC_APP_URL only (the app's own web
  // origin) — NOT reflect-any. To embed the public booking widget on other
  // domains, list them here, e.g. CORS_ORIGINS="https://acme.com,https://foo.io".
  CORS_ORIGINS: z.string().optional(),

  // Rate limiting (public booking/availability). A per-IP token bucket: burst up
  // to CAPACITY, sustained REFILL tokens/sec. Enabled by default; a fork can
  // disable it or plug a distributed limiter in the private overlay.
  RATE_LIMIT_ENABLED: boolish.default('true'),
  RATE_LIMIT_CAPACITY: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_REFILL_PER_SEC: z.coerce.number().positive().default(1),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export const clientEnvSchema = z.object({
  NEXT_PUBLIC_API_URL: z.string().url().default('http://localhost:4000'),
});

export type ClientEnv = z.infer<typeof clientEnvSchema>;

/** Parse + validate server env, throwing a readable error on misconfiguration. */
export function loadServerEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  const parsed = serverEnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  // Fail loud: the `local` auth backend is an unauthenticated dev stub and must
  // never serve production. A fork has to consciously opt into a real provider
  // (WorkOS overlay) — we refuse to boot rather than silently run wide open.
  if (parsed.data.NODE_ENV === 'production' && parsed.data.AUTH_PROVIDER === 'local') {
    throw new Error(
      'Refusing to boot: AUTH_PROVIDER=local is an unauthenticated development stub and cannot run in ' +
        'production. Set AUTH_PROVIDER=workos (with the private auth overlay) or another real provider.',
    );
  }
  return parsed.data;
}

/** True when DATABASE_URL points at Postgres (vs SQLite). */
export function isPostgresUrl(url: string): boolean {
  return url.startsWith('postgres://') || url.startsWith('postgresql://');
}
