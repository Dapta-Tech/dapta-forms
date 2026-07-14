# Dapta Forms — guide for Claude Code (and any AI coding agent)

This file is loaded automatically by Claude Code for anyone working in this repo.
It is the operating summary: how to run, test, and change **Dapta Forms** without
breaking the invariants that keep the project self-hostable and open. Deeper
rationale (request flow, package boundaries, the ports/adapters seams) lives in
[`ARCHITECTURE.md`](ARCHITECTURE.md); contribution mechanics (DCO, PR gates) live
in [`CONTRIBUTING.md`](CONTRIBUTING.md). Read those two when this summary points
you at them.

> **Naming:** the product is **Dapta Forms**. Internal packages use the `@quill/*`
> scope — `quill` is the codename, nothing more. Prefer "Dapta Forms" in
> user-facing text and `@quill/*` only when naming a package.

## What this is

An open-source, self-hostable forms platform: multi-step forms with skip-logic,
lead scoring, outcome buckets, partial + complete submissions, a first-party
funnel-event stream, durable email notifications, and short shareable links. A
Turborepo + pnpm-workspaces monorepo of two apps and seven packages. **Postgres
is the source of truth** (CI and production); **SQLite is a zero-infra dev
accelerator** so a bare clone runs in seconds.

## Repo map

```
apps/
  web/   Next.js 16 App Router (RSC) — public form pages + admin dashboard + builder
  api/   NestJS — public form API, admin/host API, outbox worker
packages/
  types/          zod contracts shared by web + api (formConfig v1, submissions, events)
  engine/         pure form logic — skip-logic, validation, scoring, outcomes (NO I/O)
  db/             Drizzle schema (pg + sqlite) + migrations + seed + repositories
  notifications/  EmailProvider port + adapters (log-only/noop/smtp/http) + notifier
  destinations/   SubmissionDestination port + adapters (webhook/hubspot/log-only)
  shared/         i18n (en/es), handle utils, growth attribution, design tokens
  config/         zod env schema + shared tsconfig/prettier presets
```

Dependency direction is one-directional: **apps depend on packages, never the
reverse; the web app reaches the API only over HTTP** (it never imports `@quill/db`
or the engine for data at runtime). The engine is pure and shared by both apps, so
the client-side preview and the server-side verdict always agree.

## How to run (zero-infra SQLite path)

```bash
pnpm install     # Node >= 20, pnpm >= 10
pnpm dev         # builds packages, migrates + seeds a SQLite DB, starts web + api
```

`pnpm dev` runs `db:setup` (migrate + seed) **before** launching the apps, so the
schema always exists. Then open:

- **Web** → http://localhost:3000 — seeded demo form at
  `/acme/alex-rivera/lead-qualifier`
- **API** → http://localhost:4000/health → `{"status":"ok",…,"dialect":"sqlite"}`

No Docker, no Postgres, no accounts. The DB is a file at `.data/dev.db`; email is
`log-only` (submission notices print to the API log); dashboard auth is a local
stub (you are logged in as the seeded demo account). Reset demo data with
`pnpm db:reset`.

**Ports.** The defaults above are what `pnpm dev` binds. To relocate the **API**,
set `API_PORT` (the Nest app reads it at runtime) and point the web app at it with
`NEXT_PUBLIC_API_URL`. The **web** dev port is set by the `apps/web` dev script; to
run it elsewhere use `pnpm --filter @quill/web exec next dev -p <port>`. See
`.env.example` for every knob — all have safe defaults.

**Postgres parity mode** (matches CI + production):

```bash
pnpm dev:pg            # docker compose up postgres, migrate + seed, run both apps
PG_PORT=5433 pnpm dev:pg   # if 5432 is taken locally
```

The `.claude/skills/local-dev` skill wraps boot / seed / login / reset / parity as
an invokable recipe if you'd rather not remember the commands.

## How to test

Vitest across the board (no Jest). Run from the repo root:

```bash
pnpm test            # all packages + apps (SQLite)
pnpm typecheck
pnpm lint
pnpm build           # builds packages AND both apps (what CI builds)
```

Scope to one workspace, or one file:

```bash
pnpm --filter @quill/engine test
pnpm --filter @quill/engine exec vitest run src/form-logic.spec.ts
```

**Postgres parity test** (the submission-integrity path CI asserts on every PR):

```bash
docker compose up -d --wait db
DATABASE_URL=postgres://quill:quill@localhost:5432/quill pnpm db:migrate
DATABASE_URL=postgres://quill:quill@localhost:5432/quill pnpm db:seed
DATABASE_URL=postgres://quill:quill@localhost:5432/quill pnpm --filter @quill/db test
```

`packages/db/src/submission.spec.ts` runs against `DATABASE_URL` on **both**
dialects and asserts the `submission_form_session_uq` unique index rejects a
duplicate — that is the SQLite↔Postgres parity guarantee. If you touch the DB
layer, run this before you push.

## Architecture invariants (a change MUST respect these)

1. **Dual-dialect schema parity + additive-only migrations.** The data model lives
   in two files — `packages/db/src/schema.pg.ts` (source of truth) and
   `packages/db/src/schema.sqlite.ts` (portable subset). They mirror 1:1 on
   table/column names (Postgres `jsonb`/`bigint` ↔ SQLite `text` JSON/`integer`
   epoch-ms). Any schema change edits **both**, ships a numbered migration in
   **both** `packages/db/migrations/{postgres,sqlite}/`, and is **additive** — new
   nullable columns / new tables, never a destructive rename or drop that would
   break a running deployment.
2. **The engine is pure functions with tests.** `@quill/engine` has no DB, no fs,
   no network (only `node:crypto`). Skip-logic, validation, scoring, and outcome
   resolution are deterministic and unit-tested. Keep it that way — never import
   I/O into `packages/engine`.
3. **Public/admin API split + account scoping on every admin route.** Public form
   endpoints (`apps/api/src/public.controller.ts`, `/v1/public/*`) are unauthed and
   rate-limited. Admin/host endpoints resolve a principal via
   `this.auth.resolveHost(req)` and pass `accountId` into every repository call so
   queries are scoped to that account. A new admin route MUST resolve the principal
   and pass its `accountId` — never query across accounts. Role checks live in
   `apps/api/src/permissions.ts`.
4. **Config is a versioned zod schema — extend, never break v1.** The form config
   contract is `formConfigSchema` in `packages/types/src/index.ts` with
   `version: z.literal(1)`. Add optional fields; do not remove or repurpose
   existing ones. A published form's stored config must keep parsing.
5. **Outbox for side-effects.** Emails and destination deliveries are enqueued to a
   transactional **outbox** and drained by `apps/api/src/outbox.worker.ts` with
   retry + exponential backoff (`backoffMs` in `packages/db/src/outbox.ts`). Never
   fire an email or webhook inline from a request handler — enqueue it (see
   `apps/api/src/email-effects.ts`, `destination-effects.ts`).
6. **Auth behind a port — never import provider specifics outside it.** The auth
   port is `apps/api/src/auth.provider.ts` (`local` stub + `createAuthProvider`);
   the WorkOS adapter is `auth.provider.workos.ts`, selected by `AUTH_PROVIDER`.
   No WorkOS-specific import may leak into controllers, services, or the web app —
   they depend on the port only. A bare fork runs on the `local` provider with no
   external identity service.
7. **Ports/adapters for email + destinations.** Public packages depend on ports
   (`EmailProvider`, `SubmissionDestination`, the DB factory), never on a concrete
   third-party adapter. Adapters are wired by configuration
   (`packages/notifications/src/factory.ts`, `packages/destinations/src/factory.ts`)
   and gracefully degrade to `log-only` when their settings are absent, so a fork
   runs with nothing configured.
8. **i18n EN + ES for every user-facing string.** All copy lives in
   `packages/shared/src/i18n/index.ts` as one typed `FormsMessages` catalog with
   `en` and `es` objects — the compiler enforces key parity. Never hardcode
   user-facing strings in components; add the key to both locales.
9. **No secrets, ever.** Server-only secrets never reach the browser (only
   `NEXT_PUBLIC_*` is client-exposed); webhook/destination secrets are masked in
   responses and stripped from public payloads. `.env` is gitignored; only
   `.env.example` (placeholders) is committed. The `scripts/publish-gate.sh` secret
   scan runs in CI — do not add real hosts, tokens, or credentialed URLs anywhere.

## Review gates a PR must pass

- **DCO sign-off** on every commit: `git commit -s` (adds `Signed-off-by:`). Not a
  CLA. Enforced by `.github/workflows/dco.yml`.
- **Conventional Commit** title (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`,
  `chore:` …) — enforced by commitlint.
- **CI green**: lint + typecheck + `pnpm test` on **SQLite**, a **Postgres** parity
  job (the unique-index submission-integrity test), a full `pnpm build`, and the
  **publish-gate** secret scan. See `.github/workflows/ci.yml`.
- **Changeset** if you changed a published package's behavior: `pnpm changeset`.
- **OptiBot triage**: the repo runs automated PR review (OptiBot). Address every
  comment before merge — fix it, or reply explaining why it does not apply. Do not
  merge over unresolved review comments.

Before opening a PR, run the read-only **`forms-reviewer`** agent
(`.claude/agents/forms-reviewer.md`) — it checks your diff against the invariants
above and the gates so CI does not surprise you.

## Common tasks (file pointers)

**Add a question type, end-to-end** (order matters):
1. `packages/engine/src/form-logic.ts` — add to `FORM_FIELD_TYPES`; add branches in
   `validateAnswer` + `validateAnswerCode`; extend `computeScore` if it is scored.
2. `packages/engine/src/form-config.ts` — per-type defaults in `createEmptyStep`.
3. `packages/types/src/index.ts` — add any new step fields to `formStepSchema` (the
   type enum is re-exported from the engine, so it updates automatically); add a new
   `ValidationCode` if you introduced one.
4. `packages/shared/src/i18n/index.ts` — label under `admin.editor.types` and any
   new `renderer.errors.*` code, in **both** `en` and `es`.
5. `apps/web/app/admin/forms/[id]/edit/_components/` — `step-list.tsx` (register in
   `STEP_TYPES`) and `step-properties.tsx` (the editing panel); add an editor
   component if the type needs one.
6. `apps/web/components/public/step-input.tsx` — add a `case` to the render switch.
7. Tests: `packages/engine/src/form-logic.spec.ts` (+ `form-config.spec.ts`).

**Add a destination adapter** (CRM/webhook sync):
`packages/destinations/src/destination.port.ts` (extend the driver union) →
`src/adapters/<name>.ts` (implement `SubmissionDestination`; throw only on
retryable failures) → `src/factory.ts` (add the switch case + graceful fallback) →
`src/index.ts` (export) → `packages/types/src/index.ts` (add the schema variant to
`formDestinationSchema`) → UI in
`apps/web/app/admin/forms/[id]/integrations/` → test `src/adapters/<name>.spec.ts`.

**Add a language:** `packages/shared/src/i18n/index.ts` — extend the `Locale` union,
add a full `FormsMessages` const (the interface forces complete key coverage), wire
it into `getMessages`. Web selection lives in `apps/web/lib/locale.ts` and
`components/language-switcher.tsx`.

## Related

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — request flow, package dependency direction,
  the ports/adapters seams.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — DCO, commit conventions, PR flow.
- [`SECURITY.md`](SECURITY.md) — reporting vulnerabilities (never a public issue).
- [`.claude/agents/forms-reviewer.md`](.claude/agents/forms-reviewer.md) /
  [`forms-contributor.md`](.claude/agents/forms-contributor.md) — the review + coding
  agents for this repo.
