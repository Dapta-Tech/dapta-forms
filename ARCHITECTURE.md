# Architecture

Dapta Forms is a Turborepo + pnpm-workspaces monorepo: two deployable apps over
seven packages. This page is the map — the request flow, the dependency direction,
and the ports/adapters seams that keep the project self-hostable. For how to run
and change it, see [`CLAUDE.md`](CLAUDE.md); for contribution mechanics,
[`CONTRIBUTING.md`](CONTRIBUTING.md).

## The two request paths

A **public respondent** filling out a form and an **admin** building one take
different routes through the system. The web app never touches the database — it
always goes through the API over HTTP, so the two apps deploy independently.

```
  PUBLIC RESPONDENT                              ADMIN / FORM BUILDER
  ────────────────                               ────────────────────
  Browser                                        Browser
     │  GET /[account]/[handle]/[slug]              │  /admin/... (dashboard + builder)
     ▼                                              ▼
  apps/web (Next.js, RSC)                        apps/web (Next.js, RSC + islands)
     │  server-renders published config             │  lib/admin-api.ts
     │  walks visible steps client-side             │  (Bearer JWT  |  x-quill-email)
     │  uses @quill/engine for skip-logic           ▼
     │  + client-side validation preview         apps/api  (admin/host controllers)
     ▼                                              │  resolveHost(req) → { accountId, role }
  apps/api  (public controller, /v1/public/*)      │  permissions.ts role checks
     │  unauthed + rate-limited                     │  every repo call scoped by accountId
     │  recompute score server-side (engine)        ▼
     │  upsert ONE submission per (form, session) ┌─────────────────────────────────┐
     ▼                                            │ packages/db (Drizzle repositories)│
  packages/db  ── upsert submission ─────────────▶│  pg (source of truth) | sqlite    │
     │           record funnel event              └─────────────────────────────────┘
     │  enqueue side-effects to the OUTBOX table
     ▼
  apps/api/outbox.worker.ts  (poll + retry/backoff)
     ├── @quill/notifications → EmailProvider adapter (log-only|noop|smtp|http)
     └── @quill/destinations  → SubmissionDestination adapter (webhook|hubspot|log-only)
```

Two properties fall out of this shape:

- **The engine is shared and pure**, so the client-side preview verdict and the
  server-side authoritative verdict always agree. The score is *always* recomputed
  server-side from the stored config — a client can never assert its own score.
- **Side-effects are decoupled from the request.** The submission commits, a row is
  written to the `outbox`, and the request returns. A background worker drains the
  outbox with exponential backoff, so a slow or down email/CRM provider never fails
  or blocks a submission. One submission per `(form_id, session_id)` is guaranteed
  by an app-level upsert **and** a unique index enforced on both dialects.

## Package dependency direction

Dependencies point one way: apps depend on packages; packages depend only on
packages below them; nothing depends on an app. `types` and `engine` are the
shared foundation.

```
        apps/web  ────HTTP────▶  apps/api
            │                        │
            ├──────────┬────────┐    ├──────────┬───────────────┬──────────────┐
            ▼          ▼        ▼    ▼          ▼               ▼              ▼
        @quill/engine  @quill/types  @quill/db  @quill/notifications  @quill/destinations
            │              │            │              │                    │
            └──────────────┴────────────┴──────────────┴────────────────────┘
                                        │
                          @quill/shared      @quill/config
                          (i18n, tokens,     (zod env schema,
                           handles, growth)   tsconfig presets)
```

- **`@quill/types`** — the zod contracts both apps validate against: `formConfig`
  (versioned, `version: 1`), submissions, and funnel events. The type enum for form
  fields is re-exported from the engine so there is one source of truth.
- **`@quill/engine`** — pure, I/O-free form logic: skip-logic (`showWhen`/`hideWhen`),
  field validation, option/slider scoring, outcome resolution, manage-token hashing,
  short-link rules. Fully unit-tested; imports only `node:crypto`.
- **`@quill/db`** — one portable schema over SQLite (dev) and Postgres (prod) via
  Drizzle, plus migrations, seed, and the account-scoped repositories.
- **`@quill/notifications`** / **`@quill/destinations`** — the two side-effect
  ports and their adapters (below).
- **`@quill/shared`** — i18n (`en`/`es`), design tokens, handle utils, growth
  attribution. **`@quill/config`** — the zod env schema and shared TS/prettier
  presets.

## The ports/adapters seams

Three boundaries are defined as **ports** (interfaces) with **adapters** wired by
configuration. Public code depends on the port; the concrete third-party adapter is
selected at runtime and **degrades to a safe default when unconfigured** — so a fork
with an empty `.env` runs end-to-end.

| Seam | Port | Adapters | Selector | Bare-fork default |
|---|---|---|---|---|
| **Email** | `packages/notifications/src/email.port.ts` | `log-only`, `noop`, `smtp`, `http` | `EMAIL_PROVIDER` | `log-only` (prints to API log) |
| **Destinations** | `packages/destinations/src/destination.port.ts` | `log-only`, `webhook`, `hubspot` | per-form config + env | `log-only` |
| **Database** | `createDb(url)` in `packages/db/src/client.ts` | Postgres (`postgres://…`) or SQLite (`file:…`) | `DATABASE_URL` | SQLite at `.data/dev.db` |
| **Auth** | `apps/api/src/auth.provider.ts` | `local` stub, `workos` (HS256 JWT) | `AUTH_PROVIDER` | `local` (no identity server) |

Rules that keep the seams intact (enforced by the `forms-reviewer` agent):

- A concrete adapter's third-party symbols never leak past its file — controllers,
  services, and the web app depend on the port only. Selecting a provider without
  its required secret fails loud; it never silently falls back to an insecure path.
- The **database** has two schema files — `schema.pg.ts` (source of truth) and
  `schema.sqlite.ts` (a portable subset mirroring it 1:1). Migrations are numbered
  in parallel under `migrations/{postgres,sqlite}` and are **additive-only**, so the
  same repository code runs on either dialect and CI can assert parity on Postgres.

## See also

- [`CLAUDE.md`](CLAUDE.md) — run/test commands, invariants, common-task file pointers.
- [`README.md`](README.md) — quickstart and feature overview.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — DCO, commit conventions, PR gates.
