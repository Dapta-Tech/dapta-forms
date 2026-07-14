# Dapta Forms

[![CI](https://github.com/Dapta-Tech/dapta-forms/actions/workflows/ci.yml/badge.svg)](https://github.com/Dapta-Tech/dapta-forms/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-a3e635.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

**Open-source forms by [Dapta](https://dapta.ai).** Multi-step forms with
skip-logic (show/hide conditions), lead scoring, outcome buckets, partial and
complete submissions, a first-party funnel-event stream, durable email
notifications, and short shareable links.
**Postgres is the source of truth** (CI and production run Postgres); **SQLite
is a zero-infra dev accelerator** so you can clone-and-run in 60 seconds.
Self-host anywhere Node or Docker runs.

> Package scope note: internal packages use the `@quill/*` scope — the
> project's codename. The product is **Dapta Forms**.

## 60-second quickstart

```bash
git clone https://github.com/Dapta-Tech/dapta-forms.git forms && cd forms
pnpm install          # Node >= 20, pnpm >= 10
pnpm dev              # builds packages, creates + seeds a SQLite DB, starts both apps
```

Then open (`pnpm dev` binds web **3000** and api **4000**):

- **Web** → http://localhost:3000 — a seeded demo form at
  [`/acme/alex-rivera/lead-qualifier`](http://localhost:3000/acme/alex-rivera/lead-qualifier)
- **API** → http://localhost:4000/health

> Relocating ports: set `API_PORT` (the API reads it) and point the web app at it
> with `NEXT_PUBLIC_API_URL`. The web dev port comes from the `apps/web` dev
> script — run it elsewhere with `pnpm --filter @quill/web exec next dev -p <port>`.

No Docker, no Postgres, no VPN, no accounts. The database is a file at
`.data/dev.db`; email is `log-only` (submission notices print to the API log).
Reset the demo data anytime with `pnpm db:reset`.

### Two dev modes

| Mode | Command | Database | Use it for |
|---|---|---|---|
| **Fast** | `pnpm dev` | SQLite file (`.data/dev.db`) | 30-second onboarding, zero infra |
| **Parity** | `pnpm dev:pg` | Postgres (Docker) | Full parity with CI + production |

`pnpm dev:pg` starts a Postgres container (`docker-compose.yml`), migrates,
seeds, and runs both apps against it — the **same engine as CI and production
(managed Postgres)**. Postgres is the source of truth; SQLite is a portable
subset for convenience and **never limits the schema**.

> **Port already in use?** The container maps host port **5432** by default. If
> you already run Postgres locally (e.g. Homebrew), set `PG_PORT` to remap the
> host side — it's read by both `docker-compose.yml` and the `dev:pg` script:
> ```bash
> PG_PORT=5433 pnpm dev:pg
> ```
> On Windows, run the `pnpm` scripts from **git-bash or WSL** — they use POSIX
> shell syntax (`${PG_PORT:-5432}`) that `cmd.exe`/PowerShell don't expand.

## What you get

- A **public form page** (`/[accountCode]/[handle]/[slug]`) that server-renders
  the published config and walks the visible steps client-side.
- A **pure forms engine** (`@quill/engine`) — skip-logic (`showWhen`/`hideWhen`),
  server-side field validation, option/slider scoring, outcome resolution,
  hashed manage tokens, short-link rules. No DB, no I/O, fully tested.
- **One portable schema** over SQLite (dev) and Postgres (prod) via `DATABASE_URL`
  (`@quill/db`, Drizzle).
- **One submission per session** — partial saves upgrade in place to a complete
  submission; a unique index backs it on both dialects (the parity guarantee).
- A first-party **funnel-event stream** (`view` / `start` / `step_view` /
  `step_complete` / `partial_submit` / `submit`) for drop-off analytics.
- **Hexagonal notifications** (`@quill/notifications`) — an `EmailProvider` port
  with `log-only` / `noop` / `smtp` / `http` adapters, delivered durably through
  a transactional **outbox** with retry + backoff. A bare fork "sends" to the
  log; wire any provider by config.

## Architecture

```
apps/
  web/    Next.js 16 (App Router, RSC) — form UI + dashboard  → @quill/engine, @quill/shared, @quill/types
  api/    NestJS — forms + submissions API                    → @quill/engine, @quill/db, @quill/notifications
packages/
  engine/          pure form logic: skip-logic, validation, scoring (no I/O)
  db/              Drizzle schema + migrations + seed + forms repository
  notifications/   EmailProvider port + adapters + submission notifier
  shared/          handle utils, i18n, growth attribution, design tokens
  config/          zod env schema + tsconfig/eslint/prettier presets
  types/           zod contracts shared by web + api (formConfig v1, submissions, events)
```

The web app talks to the API over HTTP — it never imports the database directly,
so the two deploy independently. The engine is pure and shared by both, so the
client preview and the server verdict always agree.

See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the full request-flow diagram, the
package dependency direction, and the ports/adapters seams.

### Submission integrity (dual enforcement)

One persisted submission per (form, session) is guaranteed by:

1. an **app-level upsert** (re-submitting a session updates the same row), and
2. a **unique index** on `(form_id, session_id)` present on **both** dialects.

The score is **always recomputed server-side** from the stored config — a
client can never assert its own score. **CI runs the Postgres path on every
PR** and directly asserts the unique index rejects a duplicate — Postgres is
the tested truth.

## Configuration

Everything has a safe default (see [`.env.example`](.env.example)). Copy it to
`.env` to override — it is loaded at boot for both apps (root + app-local) and
never overrides a variable already set in the real environment. Key vars:

| Var | Default | Notes |
|---|---|---|
| `DATABASE_URL` | `file:./.data/dev.db` | `postgres://…` switches to Postgres |
| `EMAIL_PROVIDER` | `log-only` | `noop` \| `smtp` \| `http` |
| `EMAIL_HTTP_PROFILE` | `generic` | `transactional-v1` opts into the managed contract (see `.env.example`) |
| `API_PORT` | `4000` | port the API listens on |
| `PUBLIC_APP_URL` | _(empty)_ | deployment's public URL — trusted origin for OAuth redirects + CORS; set for any real deploy |
| `NEXT_PUBLIC_API_URL` | `http://localhost:4000` | where the web app reaches the API |

## Scripts

| Command | What |
|---|---|
| `pnpm dev` | build packages, migrate + seed **SQLite**, run web + api |
| `pnpm dev:pg` | same, against **Postgres** in Docker (full parity) |
| `pnpm build` | build everything |
| `pnpm test` | run all unit tests |
| `pnpm typecheck` / `pnpm lint` | type-check / lint the workspace |
| `pnpm db:migrate` / `pnpm db:seed` / `pnpm db:reset` | database lifecycle |

> **Always start with `pnpm dev`** (or `pnpm dev:pg`) — it runs `db:setup`
> (migrate + seed) **before** launching the apps, so the schema always exists.
> If you instead run an app directly against a **fresh** database — two
> terminals, e.g. `pnpm db:migrate` then `pnpm --filter @quill/api dev` and
> `pnpm --filter @quill/web dev` — **run `pnpm db:migrate` first**. The bare app
> start does *not* migrate; booting the API against an unmigrated DB makes the
> outbox worker fail on every poll with `no such table: outbox`.

## Deploy

Quill is **deployment-agnostic** (Node runtime, no host-only APIs).

- **Docker / any Node host**: `apps/web/Dockerfile` (Next standalone) and
  `apps/api/Dockerfile` (Node runtime). Point `DATABASE_URL` at Postgres.
- `docker-compose.prod.yml` is a production-shaped self-host smoke test
  (Postgres + one-shot migrate + api + web).

## Contributing

Read [`CONTRIBUTING.md`](CONTRIBUTING.md). PRs are DCO-signed (`git commit -s`),
Conventional-Commit titled, and green on CI (SQLite + a Postgres parity job).

Working with Claude Code or another AI coding agent? [`CLAUDE.md`](CLAUDE.md) is
the agent guide (run/test commands, architecture invariants, common-task file
pointers), and `.claude/agents/` ships a read-only **forms-reviewer** and a
**forms-contributor** agent you can run in this repo.

## License

[MIT](LICENSE) © 2026 Dapta.
