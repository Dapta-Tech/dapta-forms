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
  // Public base URL of the deployment (e.g. https://forms.example.com). This is
  // the TRUSTED origin: the web builds OAuth `returnTo`/redirects from it (never
  // from attacker-controllable Host / X-Forwarded-Host headers — see
  // apps/web/lib/request-origin.ts) and the API uses it as the default CORS
  // allowlist entry. Default EMPTY: a bare self-host/dev clone leaves it unset
  // and falls back to request headers / localhost; a real deployment MUST set it.
  PUBLIC_APP_URL: z
    .string()
    .refine((v) => v === '' || /^https?:\/\/[^\s/]+/.test(v), {
      message: 'PUBLIC_APP_URL must be an http(s) URL (or empty to trust proxy headers in self-host dev).',
    })
    .default(''),
  // Rate-limit client-IP derivation behind proxies. X-Forwarded-For is
  // client-APPENDED and spoofable from the LEFT; behind exactly N trusted
  // proxies (e.g. one ALB) the real client is the Nth entry FROM THE RIGHT.
  // Unset -> 1 when PUBLIC_APP_URL is set (a fronting proxy is assumed), else 0
  // (trust only the socket peer address; ignore XFF entirely — correct for a
  // direct-exposed self-host). Set it explicitly to match your proxy depth.
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).optional(),

  // Email / notifications
  EMAIL_PROVIDER: z.enum(['log-only', 'noop', 'smtp', 'http']).default('log-only'),
  MAIL_FROM_EMAIL: z.string().default('forms@example.com'),
  MAIL_FROM_NAME: z.string().default('Forms'),

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

  // Submission destinations (CRM/webhook sync). Webhook destinations are fully
  // self-configured per form; HubSpot needs a server-side private-app token.
  // Unset = the HubSpot destination + property picker report a disabled state
  // (a webhook-only fork needs nothing here). Never sent to the browser.
  HUBSPOT_PRIVATE_APP_TOKEN: z.string().optional(),

  // Symmetric key (base64-encoded 32 bytes) for encrypting account-level
  // integration tokens at rest (the paste-token model — see account_integration).
  // Generate with: openssl rand -base64 32. Unset = the per-account connect UI
  // is disabled and the app falls back to the single-tenant env tokens above
  // (fine for an OSS/self-host fork with one HubSpot account). Server-only,
  // never sent to the browser.
  FORMS_ENCRYPTION_KEY: z
    .string()
    .refine((v) => v === '' || Buffer.from(v, 'base64').length === 32, {
      message: 'FORMS_ENCRYPTION_KEY must be a base64-encoded 32-byte key (openssl rand -base64 32).',
    })
    .optional(),

  // Booking sync (Calendly enrichment). Server-only personal access token the
  // `booking_sync` outbox handler uses to fetch the scheduled event + invitee
  // after a visitor books through an outcome's scheduling handoff. Unset =
  // the handler degrades gracefully (no Calendly enrichment; it logs and works
  // from whatever the callback carried). Never sent to the browser.
  CALENDLY_API_TOKEN: z.string().optional(),

  // Premium features (vanity slug + future perks). Forms is ALWAYS free —
  // `locked` gates premium on the customer's Dapta AI subscription via the
  // entitlement service below; `open` (default) unlocks everything, so a bare
  // OSS fork gets every feature with no upstream wired.
  PREMIUM_FEATURES: z.enum(['open', 'locked']).default('open'),
  // Upstream entitlement service (cloud only): base URL + service key. Unset
  // selects the disabled provider (OSS default).
  ENTITLEMENTS_API_URL: z.string().url().optional(),
  ENTITLEMENTS_API_KEY: z.string().optional(),

  // Onboarding: auto-seed a polished DEMO form into every brand-new account
  // (JIT on first login) so a new user's admin is never empty and immediately
  // shows a well-designed example. Idempotent — only ever runs when the account
  // has zero forms, so a repeat login never duplicates it and the user can
  // delete it like any normal form. Default ON; a fork can set it to false to
  // ship empty workspaces.
  SEED_DEMO_FORM: boolish.default('true'),

  // Onboarding WIZARD: the whole first-run experience — three qualifying
  // questions, then the person picks the template their first form is built
  // from. ON by default: the deploy pipeline is the rollout gate (dev
  // auto-releases first, prd is a manual promotion), so a config-side default
  // of off would only re-create that gate in a file a second team owns. The
  // flag stays as an emergency kill switch and a fork's opt-out, not as a
  // step of the rollout.
  //
  // It also SUPPRESSES the auto-seed above, and must: `seedDemoFormForAccount`
  // only writes when the account has zero forms, so a demo seeded at first login
  // would make the account non-empty and the wizard's own form would never be
  // created. The two features are mutually exclusive by construction, not by
  // convention — see `maybeSeedDemoForm`'s callers.
  //
  // Suppressing the seed is also what makes abandonment MEASURABLE: with it off,
  // someone who quits mid-wizard is left with zero forms, which is a fact the
  // funnel can see. With a demo seeded for everyone, that state is invisible.
  ONBOARDING_WIZARD: boolish.default('true'),

  // Auth — unset selects the local dev stub.
  AUTH_PROVIDER: z.enum(['local', 'workos']).default('local'),

  // DEV ONLY — which host the local stub logs in as. When AUTH_PROVIDER=local
  // and this is set (or an `x-quill-email` header is sent), the stub resolves
  // the member with this email, JIT-creating a fresh account+member if none
  // exists — so a developer lands in THEIR own workspace instead of the first
  // seeded demo account. Ignored in production (the stub refuses to boot there).
  DEV_LOGIN_EMAIL: z.string().optional(),

  // DEV ONLY — when true, the local stub does NOT fall back to the seeded/
  // DEV_LOGIN_EMAIL account: a request with no identity (no impersonation
  // headers, no `x-quill-email`) resolves to 401 UNAUTHENTICATED. This gives
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

  // Outbox worker (B7/DM1): drains durable side-effects (submission emails,
  // webhook delivery) with retry+backoff. Enabled by default; the poll interval
  // and retry ceiling are tunable. Set OUTBOX_WORKER_ENABLED=false to run the
  // API without the background drainer (e.g. when a separate worker process owns
  // it). On a bare clone the queue is empty, so the worker just idles.
  OUTBOX_WORKER_ENABLED: boolish.default('true'),
  OUTBOX_POLL_MS: z.coerce.number().int().positive().default(5000),
  OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  // The delivery cap must remain below the fixed five-minute stale lease. A
  // timed-out external call may continue despite abort, so the worker settles
  // first and accounts for the detached operation separately.
  OUTBOX_MAX_DELIVERY_MS: z.coerce.number().int().positive().lt(300_000).default(120_000),
  OUTBOX_MAX_ORPHANS: z.coerce.number().int().positive().default(8),

  // CORS: a comma-separated allowlist of origins permitted to call the API from
  // a browser. When UNSET we default to PUBLIC_APP_URL only (the app's own web
  // origin) — NOT reflect-any. To embed the public form widget on other
  // domains, list them here, e.g. CORS_ORIGINS="https://acme.com,https://foo.io".
  CORS_ORIGINS: z.string().optional(),

  // Rate limiting (public form submission). A per-IP token bucket: burst up
  // to CAPACITY, sustained REFILL tokens/sec. Enabled by default; a fork can
  // disable it or plug a distributed limiter in the private overlay.
  RATE_LIMIT_ENABLED: boolish.default('true'),
  RATE_LIMIT_CAPACITY: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_REFILL_PER_SEC: z.coerce.number().positive().default(1),

  // Product analytics — OUR OWN telemetry about the people who USE Dapta Forms
  // (signup, publish, activation), drained from the outbox by AnalyticsCapture.
  //
  // NOT to be confused with NEXT_PUBLIC_POSTHOG_KEY, which is a DIFFERENT thing
  // that already exists: the deployment-wide default for the tracking pixels a
  // form OWNER puts on their own PUBLIC form page to measure THEIR respondents
  // (see apps/web/components/tracking/resolve-tracking.ts). The two must never
  // share a variable — pointing them at one key would inject our telemetry into
  // every customer's public form.
  //
  // Unset (the default) = product analytics OFF: nothing is enqueued and
  // nothing is sent, so a bare fork runs end to end and makes zero third-party
  // requests. This is a write-only ingestion key, never a personal API key.
  PRODUCT_ANALYTICS_KEY: z.string().optional(),
  PRODUCT_ANALYTICS_HOST: z.string().url().default('https://us.i.posthog.com'),

  // Dapta-estate onboarding sync (cloud only) — the `dapta_sync` outbox kind.
  // On the wizard's first answer and on completion, the API pushes the new
  // account into the rest of the Dapta estate: mappable answers to the IAM's
  // onboarding endpoints, then a call to the FlowStudio contact-sync flow that
  // upserts the HubSpot contact.
  //
  // IAM_BASE_URL here is a DELIBERATE REVERSAL of "the API has no IAM_BASE_URL"
  // (see completeOnboarding): the cohort *probe* still runs in the web, but the
  // sync is a durable outbox side-effect and those run in the API. The same
  // IAM_API_KEY value is ALSO read by the web (the probe's `x-api-key`).
  //
  // All four unset (the default, and every bare fork) = the feature does not
  // exist: nothing is enqueued, no third-party request is ever made.
  IAM_BASE_URL: z.string().url().optional(),
  IAM_API_KEY: z.string().optional(),
  DAPTA_SYNC_FLOW_URL: z.string().url().optional(),
  DAPTA_SYNC_FLOW_KEY: z.string().optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export const clientEnvSchema = z.object({
  NEXT_PUBLIC_API_URL: z.string().url().default('http://localhost:4000'),

  // Browser half of product analytics (pageviews + admin activity). Same
  // project as PRODUCT_ANALYTICS_KEY above; deliberately a SEPARATE name from
  // the per-form NEXT_PUBLIC_POSTHOG_* pixels — see the note there. The
  // ingestion key is public by design (it ships in every bundle and can only
  // write events), which is exactly why it may be NEXT_PUBLIC_. Unset = the
  // admin loads no analytics script at all.
  NEXT_PUBLIC_PRODUCT_ANALYTICS_KEY: z.string().optional(),
  NEXT_PUBLIC_PRODUCT_ANALYTICS_HOST: z.string().url().default('https://us.i.posthog.com'),

  // The deployment's own GTM container for PLATFORM pages (login, onboarding,
  // admin) — the marketing half of the telemetry above. NOT to be confused
  // with NEXT_PUBLIC_GTM_ID, which is the form OWNER's container on their
  // PUBLIC form pages; the two must never share a variable or a page (see
  // apps/web/components/analytics/platform-gtm.tsx). Unset on a Dapta (workos)
  // build falls back to Dapta's own container in code; unset on a bare fork =
  // no platform GTM at all.
  NEXT_PUBLIC_PLATFORM_GTM_ID: z.string().optional(),
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

/** True when DATABASE_URL points at Postgres (vs SQLite). Scheme is case-insensitive. */
export function isPostgresUrl(url: string): boolean {
  const u = url.toLowerCase();
  return u.startsWith('postgres://') || u.startsWith('postgresql://');
}
