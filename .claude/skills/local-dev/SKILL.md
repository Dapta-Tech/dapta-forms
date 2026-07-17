---
name: local-dev
description: Boot, seed, log in, reset, and switch database dialect for Dapta Forms locally. Use when you need to run the app, get into the admin dashboard as a specific user, reset demo data, or exercise the Postgres parity path.
---

# Local dev — Dapta Forms

Zero infrastructure: a bare clone runs on SQLite with `log-only` email and a
`local` auth stub. No Docker, Postgres, or accounts required for the fast path.

## Boot (SQLite, fast path)

```bash
pnpm install          # Node >= 20, pnpm >= 10
pnpm dev              # builds packages, migrates + seeds SQLite, runs web + api
```

- Web → http://localhost:3000 · API → http://localhost:4000/health
- Seeded demo form → http://localhost:3000/acme/alex-rivera/lead-qualifier
- DB file → `.data/dev.db` · emails print to the API log (`log-only`)

`pnpm dev` always runs `db:setup` (migrate + seed) before the apps start, so the
schema exists. If you instead start an app directly against a **fresh** DB, run
`pnpm db:migrate` first — otherwise the outbox worker fails with `no such table:
outbox`.

**Relocating ports:** set `API_PORT` (the Nest app reads it) and point the web app
at it via `NEXT_PUBLIC_API_URL`. The web dev port comes from the `apps/web` dev
script — run it elsewhere with `pnpm --filter @quill/web exec next dev -p <port>`.

**Second instance alongside the default (parallel convention):** to run a second
copy while `pnpm dev` holds :3000/:4000, use **web :3400 / api :4400** and give it
its **own DB via an absolute `DATABASE_URL`** so the two instances never share
`.data/dev.db`. Point the second web at the second api:

```bash
# API on 4400, its own SQLite file (absolute path avoids cwd/collision surprises)
API_PORT=4400 DATABASE_URL="file:/abs/path/forms-b.db" pnpm --filter @quill/api dev
# Web on 3400, talking to the 4400 API
NEXT_PUBLIC_API_URL=http://localhost:4400 pnpm --filter @quill/web exec next dev -p 3400
```

Migrate the second DB first (`DATABASE_URL="file:/abs/path/forms-b.db" pnpm db:migrate`)
or the outbox worker fails on boot.

## Log in to the dashboard

With `AUTH_PROVIDER=local` (the default), you are logged in as the seeded demo
account. To act as a specific user:

- Set `DEV_LOGIN_EMAIL=you@example.com` in `.env` — the stub resolves that member,
  JIT-creating a fresh account + member if none exists.
- Or send the header `x-quill-email: you@example.com` on an API request (it
  overrides `DEV_LOGIN_EMAIL`).
- Set `AUTH_LOCAL_STRICT=true` to get a real "logged out" state (a request with no
  identity returns 401 instead of falling back to the seeded account), so you can
  exercise the login/logout redirect flow.

To test the WorkOS-style JWT path offline (no identity server), mint a token the
`workos` provider will accept:

```bash
pnpm --filter @quill/api auth:mint -- --account acct_dev --sub user_dev
# then call the API with:  Authorization: Bearer <token>
```

## Reset demo data

```bash
pnpm db:reset         # drop + recreate + reseed the current database
```

## Postgres parity mode (matches CI + production)

```bash
pnpm dev:pg               # docker compose up postgres, migrate + seed, run both apps
PG_PORT=5433 pnpm dev:pg  # if host port 5432 is already in use
```

Run the submission-integrity parity test directly against Postgres:

```bash
docker compose up -d --wait db
DATABASE_URL=postgres://quill:quill@localhost:5432/quill pnpm db:migrate
DATABASE_URL=postgres://quill:quill@localhost:5432/quill pnpm db:seed
DATABASE_URL=postgres://quill:quill@localhost:5432/quill pnpm --filter @quill/db test
```

On Windows, run these `pnpm` scripts from git-bash or WSL — they use POSIX shell
syntax (`${PG_PORT:-5432}`) that `cmd.exe` / PowerShell do not expand.
