# Self-hosting Dapta Forms

This is the production deployment guide for running **Dapta Forms** on your own
infrastructure. For the 60-second local dev loop see [`README.md`](README.md);
for the internals see [`ARCHITECTURE.md`](ARCHITECTURE.md).

> **Naming:** the product is **Dapta Forms**. Internal packages use the `@quill/*`
> scope — `quill` is only the codename. You will see both; they are the same thing.

## What you get

A self-contained, self-hostable forms platform — two deployable apps over seven
packages, no third-party SaaS required to run:

- A **public form page** (`/[accountCode]/[handle]/[slug]`) that server-renders
  the published config and walks the visible steps client-side.
- An **admin dashboard + form builder** (multi-step forms, skip-logic, lead
  scoring, outcome buckets, short links).
- A **NestJS API** with a public submission endpoint (unauthenticated,
  rate-limited) and an account-scoped admin API.
- **Durable side-effects** via a transactional outbox: submission emails and
  destination deliveries (webhook / HubSpot) are enqueued and drained with
  retry + backoff, so a slow or down provider never fails a submission.
- **One portable schema** over Postgres (production) and SQLite (dev/eval).

Everything degrades to a safe default: a bare deployment with nothing configured
boots on SQLite, logs emails instead of sending, and runs the local auth stub —
so you can bring up the stack first and wire providers in one at a time.

## Prerequisites

- **Node** >= 20.9 and **pnpm** >= 10 (to build the images or run from source).
- **Docker** (recommended path) — build + run the two images.
- **PostgreSQL** 14+ for production (a managed instance is recommended). SQLite is
  fine for evaluation only.
- A **reverse proxy** terminating TLS in front of the two apps (any: nginx,
  Caddy, Traefik, a cloud load balancer).

## Quickest production deploy

The repo ships [`docker-compose.prod.yml`](docker-compose.prod.yml) — a
production-shaped stack (Postgres + a one-shot migrate + api + web) built from the
**same deployment-agnostic images that a real cluster runs**. It is the "does the
whole thing come up on any Docker host?" smoke test and the fastest way to a
running instance.

```bash
# Postgres password is required (no default); everything else has a safe default.
# Replace <password> in BOTH vars with the same strong value; `db` is the compose
# service name the API reaches Postgres by.
POSTGRES_PASSWORD='<password>' \
DATABASE_URL='postgres://quill:<password>@db:5432/quill' \
docker compose -f docker-compose.prod.yml up --build
```

- Web → http://localhost:3000 · API → http://localhost:4000/health
- The `migrate` one-shot runs the DB migrations **once**, then exits, before the
  API starts. Migrations are never baked into the long-running pod, so scaling to
  N replicas never races N migrators.

What this stack does **not** do (and what you must add for a real deployment):

- It runs `NODE_ENV=development` with `AUTH_PROVIDER=local` (the unauthenticated
  dev stub) so it comes up with zero setup. **The API refuses to boot on the local
  stub under `NODE_ENV=production`** — for a real deploy set `NODE_ENV=production`
  and a real auth provider together (see [Auth options](#auth-options)).
- It does not terminate TLS or set `PUBLIC_APP_URL` — add a reverse proxy and set
  the public URL (see [Reverse proxy + TLS](#reverse-proxy--tls)).
- Email is `log-only` — wire SMTP or an HTTP mailer for real notifications.

Use it as the reference wiring, then translate it to your orchestrator (Compose,
Kubernetes, a bare Node host — the images carry no host-only APIs).

## Building the two images

Both Dockerfiles take the **repository root** as the build context.

```bash
docker build -f apps/api/Dockerfile -t dapta-forms-api .
docker build -f apps/web/Dockerfile -t dapta-forms-web \
  --build-arg NEXT_PUBLIC_API_URL=https://forms-api.example.com .
```

### API image ([`apps/api/Dockerfile`](apps/api/Dockerfile))

- Multi-stage: build with pnpm/corepack, then `pnpm deploy --legacy --prod` emits a
  **pruned single-package bundle** (only `@quill/api` + its runtime workspace deps).
  The runtime layer is **distroless** (`gcr.io/distroless/nodejs22`), non-root — no
  shell, **no pnpm, no package manager in the image**.
- The runtime uses **tsx**, not a compiled JS build. The entrypoint is:
  `node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.runtime.json src/main.ts`.
  `tsconfig.runtime.json` is required — the dev tsconfig's `extends` chain doesn't
  resolve inside the pruned bundle, and dropping it loses `experimentalDecorators`
  (→ NestJS crashes at boot).
- **Migrations are not run by this image at startup** — they are a separate gated
  step (the `migrate` one-shot service, or `pnpm db:migrate` from a checkout).
- Zero-infra default: with no `DATABASE_URL` the API opens SQLite under `/app/.data`
  (pre-created and owned by the non-root uid). For real deployments point
  `DATABASE_URL` at Postgres.

### Web image ([`apps/web/Dockerfile`](apps/web/Dockerfile))

- Next.js `output: 'standalone'` — the server + only the node_modules it needs.
  Runtime is `node apps/web/server.js`, non-root, on port 3000.
- **`NEXT_PUBLIC_*` are build args, inlined into the client bundle at build time.**
  They are baked in, not read at runtime by the browser code — so **dev and prod
  build separate web images** with their own values. Server components re-read them
  from the runtime env (the run stage re-declares them) for SSR'd metadata.
  Build args (all optional, sane defaults):
  - `NEXT_PUBLIC_API_URL` (default `http://localhost:4000`) — where the browser and
    SSR reach the API. **Set this to your public API URL at build time.**
  - `NEXT_PUBLIC_PRODUCT_NAME` (default `Forms`) — UI product name.
  - `NEXT_PUBLIC_PLATFORM_URL`, `NEXT_PUBLIC_SIGNUP_URL`, `NEXT_PUBLIC_LANDING_URL`,
    `NEXT_PUBLIC_HIDE_BADGE`, `NEXT_PUBLIC_CALENDARS_URL` — optional branding /
    growth-loop links (no signup URL = nothing rendered).

## Database

**PostgreSQL is the source of truth** (CI and production run Postgres). SQLite is a
portable subset for zero-infra dev and evaluation only — it is never allowed to
limit the schema, but you should not run production on it.

- Select the engine with `DATABASE_URL`: a `postgres://…` / `postgresql://…` URL
  selects Postgres; a `file:…` URL (or unset) selects SQLite.
- Run migrations before the API boots:
  ```bash
  DATABASE_URL='postgres://<user>:<password>@<host>:5432/<dbname>' pnpm db:migrate
  ```
  (or let the `migrate` one-shot service in `docker-compose.prod.yml` do it.)
- **Migrations are additive-only** — new nullable columns / new tables, never a
  destructive rename or drop that would break a running deployment. Both dialects
  ship parallel numbered migrations under `packages/db/migrations/{postgres,sqlite}`.
- Booting the API against an **unmigrated** database makes the outbox worker fail on
  every poll with `no such table: outbox` — always migrate first.

## Full environment reference

Every variable has a safe default that selects the zero-infra path, so a bare
deployment boots. Server variables are validated by
[`packages/config/src/env.ts`](packages/config/src/env.ts) at startup and **fail
loud** on a bad value. Copy [`.env.example`](.env.example) to `.env` to override —
`.env` never overrides a variable already set in the real environment (k8s / Docker
/ shell always wins).

### Core / API (server)

| Var | Default | Required when | Secret |
|---|---|---|---|
| `NODE_ENV` | `development` | set `production` for any real deploy | no |
| `DATABASE_URL` | `file:./.data/dev.db` | production (point at Postgres) | yes (holds DB creds) |
| `API_PORT` | `4000` | — | no |
| `PUBLIC_APP_URL` | _(empty)_ | any real deploy (trusted origin for redirects + default CORS) | no |
| `TRUST_PROXY_HOPS` | `1` if `PUBLIC_APP_URL` set, else `0` | behind a proxy — match your proxy depth | no |
| `CORS_ORIGINS` | _(app's own web origin)_ | to embed the widget on other domains | no |
| `RATE_LIMIT_ENABLED` | `true` | — | no |
| `RATE_LIMIT_CAPACITY` | `60` | — | no |
| `RATE_LIMIT_REFILL_PER_SEC` | `1` | — | no |
| `OUTBOX_WORKER_ENABLED` | `true` | set `false` only if a separate worker drains the outbox | no |
| `OUTBOX_POLL_MS` | `5000` | — | no |
| `OUTBOX_MAX_ATTEMPTS` | `5` | — | no |
| `ONBOARDING_WIZARD` | `true` | set `false` to skip the first-run wizard (and get `SEED_DEMO_FORM` back) | no |
| `SEED_DEMO_FORM` | `true` | **inert while `ONBOARDING_WIZARD` is on**; set `false` to ship empty new workspaces | no |

The two form-seeding knobs are mutually exclusive by construction. A new
workspace gets exactly one of: the wizard's chosen template (`ONBOARDING_WIZARD`
on, the default), the seeded demo form (`ONBOARDING_WIZARD=false` +
`SEED_DEMO_FORM=true`), or nothing (both off). `SEED_DEMO_FORM=true` alone does
**not** seed a form — the wizard suppresses it, so that the two can never both
write a "first" form into the same account.

### Auth

| Var | Default | Required when | Secret |
|---|---|---|---|
| `AUTH_PROVIDER` | `local` | set `workos` for a real deploy (the local stub is refused in production) | no |
| `JWT_SECRET` | _(unset)_ | **required** when `AUTH_PROVIDER=workos` (shared HS256 signing secret) | yes |
| `JWT_ISSUER` | _(unset)_ | enforced only when set | no |
| `JWT_AUDIENCE` | _(unset)_ | enforced only when set | no |
| `DEV_LOGIN_EMAIL` | _(unset)_ | dev only (ignored in production) | no |
| `AUTH_LOCAL_STRICT` | `false` | dev only | no |

### Email / notifications

| Var | Default | Required when | Secret |
|---|---|---|---|
| `EMAIL_PROVIDER` | `log-only` | choose `smtp` / `http` to actually send | no |
| `MAIL_FROM_EMAIL` | `forms@example.com` | — | no |
| `MAIL_FROM_NAME` | `Forms` | — | no |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` | _(unset)_ | when `EMAIL_PROVIDER=smtp` | no |
| `SMTP_PASS` | _(unset)_ | when `EMAIL_PROVIDER=smtp` | yes |
| `EMAIL_HTTP_ENDPOINT` | _(unset)_ | when `EMAIL_PROVIDER=http` | no |
| `EMAIL_HTTP_PROFILE` | `generic` | `generic` (default) or `transactional-v1` | no |
| `EMAIL_HTTP_TOKEN` | _(unset)_ | `generic` profile Bearer auth (optional) | yes |
| `EMAIL_HTTP_CLIENT_ID` | _(unset)_ | `transactional-v1` service id | no |
| `EMAIL_HTTP_SIGNING_SECRET` | _(unset)_ | `transactional-v1` HMAC secret (min 32 chars) | yes |
| `EMAIL_HTTP_CATEGORY` | `lifecycle` | `transactional-v1` message category | no |
| `EMAIL_HTTP_API_KEY` | _(unset)_ | **deprecated** Bearer fallback — migrate to the client-id + signing-secret pair | yes |

### Submission destinations

| Var | Default | Required when | Secret |
|---|---|---|---|
| `HUBSPOT_PRIVATE_APP_TOKEN` | _(unset)_ | to enable the HubSpot destination (else it reports a disabled state) | yes |

Webhook destinations are configured **per form in the admin UI** (URL + optional
HMAC secret) — no environment variable.

### Premium entitlements (optional; Forms itself is always free)

| Var | Default | Required when | Secret |
|---|---|---|---|
| `PREMIUM_FEATURES` | `open` | `open` unlocks everything (fork default); `locked` gates premium on the entitlement service | no |
| `ENTITLEMENTS_API_URL` | _(unset)_ | when `PREMIUM_FEATURES=locked` | no |
| `ENTITLEMENTS_API_KEY` | _(unset)_ | when `PREMIUM_FEATURES=locked` | yes |

### Dapta pipeline (optional; cloud only)

Pushes a new account's onboarding into the Dapta estate (IAM answers + the
HubSpot contact-sync flow) via the `dapta_sync` outbox kind. All four unset —
the fork default — disables the feature entirely: nothing is enqueued.

| Var | Default | Required when | Secret |
|---|---|---|---|
| `IAM_BASE_URL` | _(unset)_ | syncing onboarding answers to the IAM (API; the web already uses it for login) | no |
| `IAM_API_KEY` | _(unset)_ | same — also read by the **web** for the cohort probe | yes |
| `DAPTA_SYNC_FLOW_URL` | _(unset)_ | calling the contact-sync flow | no |
| `DAPTA_SYNC_FLOW_KEY` | _(unset)_ | calling the contact-sync flow | yes |

### Web app

`NEXT_PUBLIC_*` are **build-time** (inlined into the client bundle — pass as
`--build-arg`, see [Building the two images](#building-the-two-images)); the rest
are runtime server env for the web container.

| Var | Default | Required when | Secret |
|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:4000` | any real deploy (build arg) | no |
| `NEXT_PUBLIC_PRODUCT_NAME` | `Forms` | branding (build arg) | no |
| `NEXT_PUBLIC_PLATFORM_URL` | _(empty)_ | app-switcher link (build arg) | no |
| `NEXT_PUBLIC_SIGNUP_URL` | _(empty)_ | growth-loop opt-in — unset renders no badge/CTA (build arg) | no |
| `NEXT_PUBLIC_LANDING_URL` | product landing | where the badge/CTA point; falls back to the signup URL (build arg) | no |
| `NEXT_PUBLIC_HIDE_BADGE` | _(empty)_ | set truthy to hide the badge (build arg) | no |
| `NEXT_PUBLIC_CALENDARS_URL` | _(empty)_ | app-switcher link (build arg) | no |
| `AUTH_PROVIDER` | `local` | mirror the API value so the web picks the right login UX | no |
| `WEB_SESSION_SECRET` | _(empty)_ | **required** unless `AUTH_PROVIDER=local` — signs the httpOnly session cookie | yes |
| `IAM_BASE_URL` | _(unset)_ | **required** when `AUTH_PROVIDER=workos` — upstream identity service the web calls for the login URL / logout | no |
| `IAM_API_KEY` | _(unset)_ | the onboarding cohort probe (key-gated IAM status endpoint); unset probes fail closed to the short wizard | yes |
| `PUBLIC_APP_URL` | _(empty)_ | trusted origin for OAuth redirects (same as API) | no |

## Reverse proxy + TLS

Terminate TLS at a proxy in front of both apps and forward to web (3000) and API
(4000). Two things must line up:

- Set **`PUBLIC_APP_URL`** to the deployment's public base URL (e.g.
  `https://forms.example.com`). This is the **trusted origin**: the web builds OAuth
  `returnTo` / post-login redirects from it (never from attacker-controllable `Host`
  / `X-Forwarded-Host` headers) and it is the default CORS allowlist entry.
- Set **`TRUST_PROXY_HOPS`** to the number of trusted proxies in front of the API.
  `X-Forwarded-For` is client-appended and spoofable from the left; behind exactly N
  trusted proxies the real client IP is the Nth entry from the right (used by the
  rate limiter). One fronting load balancer = `1`. A directly-exposed host = `0`
  (trust only the socket peer, ignore `X-Forwarded-For`). It defaults to `1` when
  `PUBLIC_APP_URL` is set, else `0` — set it explicitly to match your topology.

To serve the public form widget embedded on other domains, list those origins in
`CORS_ORIGINS` (comma-separated).

## Auth options

The dashboard auth is a **port** with two adapters selected by `AUTH_PROVIDER`.
Public form pages are always open; auth only gates the admin dashboard.

- **`local` (default)** — an unauthenticated development stub. Great for evaluation.
  **The API refuses to boot with `AUTH_PROVIDER=local` under `NODE_ENV=production`** —
  it fails loud rather than silently run wide open.
- **`workos` — a generic HS256-JWT provider.** Despite the name it needs no WorkOS
  account: it validates a host-session token that is an **HS256 JWT** (claims: `sub`,
  `account_id`, `email`, `name`) signed with a **shared symmetric secret**
  (`JWT_SECRET`) minted by any upstream identity service you run. The same validation
  runs identically in local dev and remote. Selecting `workos` without `JWT_SECRET`
  fails loud. `JWT_ISSUER` / `JWT_AUDIENCE` are enforced only when set. On the web
  side this provider also needs `WEB_SESSION_SECRET` (to sign the session cookie) and
  `IAM_BASE_URL` (the identity service the web redirects through for login/logout).

To mint a token the `workos` provider accepts, without an identity server (dev/test):

```bash
pnpm --filter @quill/api auth:mint -- --account acct_dev --sub user_dev
# then call the API with:  Authorization: Bearer <token>
```

## Email options

Select with `EMAIL_PROVIDER` (the email delivery is a port + adapters):

- **`log-only` (default)** — submission notices print to the API log. A deployment
  runs end-to-end with no mail provider.
- **`noop`** — silently drop (no log).
- **`smtp`** — set `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS`.
- **`http`** — POST each message to an external send endpoint. The **`generic`**
  profile (default) sends a provider-agnostic JSON body with optional Bearer auth
  (`EMAIL_HTTP_TOKEN`) — wire it to any HTTP mail API. A `transactional-v1` profile
  also exists for a managed transactional contract (HMAC service auth via
  `EMAIL_HTTP_CLIENT_ID` + `EMAIL_HTTP_SIGNING_SECRET`).

Set `MAIL_FROM_EMAIL` / `MAIL_FROM_NAME` for the sender identity.

## Submission destinations

Beyond email, each submission can be forwarded to external systems (drained durably
through the same outbox with retry + backoff).

- **Webhook** — configured **per form in the admin UI** (endpoint URL + optional
  HMAC signing secret). When a secret is set, every delivery is signed:
  - `X-Forms-Signature: sha256=<hex>` — HMAC-SHA256 of the **raw request body**
    (`sha256=` prefix makes the scheme explicit, GitHub-style). Recompute
    `HMAC-SHA256(secret, rawBody)` and compare in constant time to verify.
  - `X-Forms-Event: form.submission` — the event name.
  - `X-Forms-Delivery: <id>` — idempotency key; de-dup on the receiver.
  - `X-Forms-Timestamp: <unix-seconds>` — the submission timestamp.
  - The signature header name is overridable per destination (default
    `X-Forms-Signature`). Redirects are refused (a 3xx fails the delivery, so an
    endpoint can't bounce a payload elsewhere), and private/loopback targets are
    rejected as SSRF.
- **HubSpot** — set `HUBSPOT_PRIVATE_APP_TOKEN` (server-side). Unset = the HubSpot
  destination and its property picker report a clear disabled state, so a
  webhook-only deployment needs nothing here.

## Upgrades & rollback

- **Upgrade:** pull the new version, rebuild both images (remember: `NEXT_PUBLIC_*`
  are baked at build time, so a changed API URL needs a web rebuild), run
  `pnpm db:migrate` (additive-only, idempotent — safe to run before rolling pods),
  then roll the API and web.
- **Rollback:** because migrations are additive-only, the previous images stay
  compatible with the newer schema — roll back by redeploying the previous image
  tags. Keep old images available (don't prune the tag you might revert to).

### Migration numbering

Migrations are recorded by **filename** in the `_migrations` table, not by a
highest-number watermark. Two consequences, both deliberate:

- A gap in the numbering is not a missing migration. Branches claim numbers
  before they merge, and they do not merge in order.
- A lower-numbered file that arrives in a later release still applies on its own,
  after a higher-numbered one has already run.

So `0016_member_profile_revision.sql` (the member write counter below) applies
independently of whatever occupies the `0015` slot; it adds one column to
`member` and depends on nothing else.

## Public page write compatibility contract

The public member page is written with a per-member revision
(`member.profile_revision`, migration `0016`). A save whose answer never reaches
the browser is ambiguous, because a client timeout does not abort the write, so
the write path is compare-and-set and the client settles ambiguity with a fence.
These are the normative invariants — change any of them and the ambiguity
becomes undecidable again.

- **N1 Scope.** `accountId` **and** `memberId` scope every profile read, write and
  fence. A member is never addressed by id alone.
- **N2 Write admission, and forward-only compatibility.**
  `PROFILE_V2_WRITES_ENABLED` admits NEW guarded saves and stays false until
  every API instance in the fleet increments the revision. It does **not** gate
  the fence: a browser holding an expectation from an earlier save can always
  settle it, on any revision-aware build. Once guarded writes have been enabled
  against a database, running an API that predates the revision is
  **unsupported** — the migration and the revision-aware API are forward-only
  compatibility infrastructure. `PROFILE_V1_WRITE_SHIM` is off by default and is
  turned on only for the bounded old-web window; it still increments the revision
  atomically with its write.
- **N3 Zero rows.** A write that changed no rows is disambiguated by an
  account-scoped re-read: absent member is `404`, a moved revision is `409`.
- **N4 Abort budget.** The server-side call budget is strictly shorter than the
  client's Server Action timeout, and an abort never proves the API did not
  commit.
- **N5 Legacy rows.** A `NULL` revision is logical 0. Predicates and increments
  use `coalesce(profile_revision, 0)`, never the bare column.
- **N6 Draft safety.** Adopting authoritative state updates stored fields (links,
  listed forms, branding, published state) and never erases the headline or bio
  the member is typing.
- **N7 Fence outcomes.** A fence conflict distinguishes a genuinely changed page
  from a revision that advanced with identical content, and neither is reported
  as a successful save.
- **N8 Reconciliation route.** Reconciliation is an authenticated, same-origin
  `POST` whose body carries only `expectedRevision`; authentication failures come
  back as JSON status codes, never as a login page with a 200.
- **N9 After settling.** A resolved reconciliation revalidates `/admin/settings`
  and refreshes the router, and a remount keeps the reconciled revision instead
  of regressing to the revision the page was first rendered with.
- **N10 Dedicated fence.** The fence advances the revision without touching
  content. A same-value write is not a substitute (schema normalization can
  change stored bytes), and neither content comparison nor a mutation id inside
  the profile blob is used.

### Rollout order

1. Run `pnpm db:migrate` (adds `member.profile_revision`, nullable).
2. Deploy the new API with `PROFILE_V2_WRITES_ENABLED=false` and
   `PROFILE_V1_WRITE_SHIM=true`. Old web keeps working through `/v1`.
3. Confirm every API instance is the new build.
4. Set `PROFILE_V2_WRITES_ENABLED=true` and roll the API.
5. Deploy the new web. It uses `/v2` only and never falls back to `/v1`.
6. When no old web pod remains, set `PROFILE_V1_WRITE_SHIM=false` (the `/v1`
   write then answers `410`). Once that has held for a release, remove the `/v1`
   route, its writer, and both flags together.

### Rollback

**Before guarded writes have ever been enabled** (step 4 above has not run on
this database), the previous API is still a supported rollback target: no
guarded write exists, so no browser holds an expectation to settle.

**After guarded writes have been enabled, rolling the API below revision
awareness is not supported.** A browser can be holding an expectation from a
save whose answer it never received, and only a revision-aware API can settle
it. An API without the fence cannot answer that question at all, so the session
is left unable to distinguish "not applied" from "applied", which is the defect
this contract exists to remove. There is no way to drain those expectations
first: they live in open browser tabs, not in the server.

The supported emergency rollback is:

1. Set `PROFILE_V2_WRITES_ENABLED=false` and roll the API. New saves stop being
   admitted immediately; the fence keeps working, so sessions in an ambiguous
   state can still resolve.
2. Roll web back if the web build is the problem.
3. Keep the revision-aware API. It is compatible with older web builds through
   the `/v1` shim (`PROFILE_V1_WRITE_SHIM=true`), which still increments the
   revision.

A hard reload remains the last resort for a client that cannot settle: it drops
the pending expectation and re-reads stored state. That is a client recovery, not
a licence to downgrade the API, because the reload shows what is stored without
ever establishing what the ambiguous save did.

Never run a write-enabled API beside an instance that writes the profile without
incrementing the revision.

## Troubleshooting

- **API won't boot: `Refusing to boot: AUTH_PROVIDER=local …`** — you set
  `NODE_ENV=production` with the local stub. Set a real `AUTH_PROVIDER=workos` +
  `JWT_SECRET` (or run non-production for evaluation).
- **`no such table: outbox` on every poll** — the API booted against an unmigrated
  DB. Run `pnpm db:migrate` (or the `migrate` one-shot) before starting the API.
- **`WEB_SESSION_SECRET is required unless AUTH_PROVIDER=local`** — set a long random
  `WEB_SESSION_SECRET` for any non-local web deployment.
- **`Invalid environment configuration:`** at startup — the zod env schema rejected a
  value; the error lists each offending variable and why. Fix and restart.
- **OAuth redirect goes to the wrong host / CORS blocks the widget** — set
  `PUBLIC_APP_URL` to the real public URL and list embed origins in `CORS_ORIGINS`.
- **Rate limiter blocks or mis-attributes clients behind a proxy** — set
  `TRUST_PROXY_HOPS` to match the number of proxies in front of the API.
- **Web calls the wrong API after moving it** — `NEXT_PUBLIC_API_URL` is inlined at
  build time; rebuild the web image with the new `--build-arg NEXT_PUBLIC_API_URL`.
- **Webhook deliveries fail with a redirect / SSRF error** — the receiver returned a
  3xx or resolves to a private/loopback address; both are refused by design.

## See also

- [`README.md`](README.md) — quickstart + feature overview.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — request flow, package boundaries, ports/adapters.
- [`.env.example`](.env.example) — every variable with inline notes.
- [`docker-compose.prod.yml`](docker-compose.prod.yml) — the reference production stack.
