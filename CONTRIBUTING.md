# Contributing to dForms

Thanks for your interest! dForms is built to be easy to hack on: clone and run it
with zero infrastructure.

## Getting started

```bash
pnpm install
pnpm dev        # SQLite is created and seeded automatically
```

Requirements: Node >= 20.9 and pnpm >= 10. No Docker or database needed.

## Running locally

- **Ports.** `pnpm dev` binds the web app to **3000** and the API to **4000**. To
  move the API, set `API_PORT` and point the web app at it with
  `NEXT_PUBLIC_API_URL`. To move the web app, run
  `pnpm --filter @quill/web exec next dev -p <port>`.
- **Postgres parity.** `pnpm dev:pg` runs everything against Postgres in Docker.
  The container maps host port **5432**; if you already run Postgres locally, set
  `PG_PORT` (read by both `docker-compose.yml` and the script):
  ```bash
  PG_PORT=5433 pnpm dev:pg
  ```
- **Windows.** Run the `pnpm` scripts from **git-bash or WSL**. They use POSIX
  shell syntax (`${PG_PORT:-5432}`) that `cmd.exe` and PowerShell do not expand.
- **Starting an app by hand.** `pnpm dev` migrates and seeds before it starts the
  apps. If you start them yourself against a fresh database (for example
  `pnpm --filter @quill/api dev` and `pnpm --filter @quill/web dev` in two
  terminals), run `pnpm db:migrate` first. Without it the outbox worker fails on
  every poll with `no such table: outbox`.

## Repository layout

See the architecture section of [`README.md`](README.md). In short: `apps/{web,api}`
plus `packages/{engine,types,db,destinations,notifications,shared,config}`, a
Turborepo and pnpm-workspaces monorepo. The packages use the `@quill/*` scope;
Quill is the codename, the product is dForms.

## Making a change

1. Create a branch off `develop`.
2. Make your change with a test. Run:
   ```bash
   pnpm typecheck && pnpm lint && pnpm test
   ```
3. If your change affects a published package's behavior, add a changeset:
   ```bash
   pnpm changeset
   ```
4. Commit with a **Conventional Commit** message and a **DCO sign-off** (below).
5. Open a PR against `develop`. CI runs lint, typecheck, tests on **SQLite** and a
   **Postgres** parity job (which exercises the submission-integrity unique-index
   path), builds both apps, runs the publish-gate secret scan and checks the
   punctuation of user-facing text (`bash scripts/dash-check.sh`).

## Commit conventions

- **Conventional Commits**: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`,
  `chore:` and so on (enforced by commitlint).
- **DCO sign-off**: we use the [Developer Certificate of Origin](https://developercertificate.org/),
  not a CLA. Sign every commit:
  ```bash
  git commit -s -m "feat: add ..."
  ```
  This appends a `Signed-off-by:` line certifying you wrote the code (or have the
  right to submit it). A CI check enforces it.

## Code style

- TypeScript strict. Validate untrusted input with **zod** at every boundary.
- Prettier owns formatting (`pnpm format`).
- Frontend: semantic Tailwind theme tokens only (no arbitrary values or raw hex),
  RSC by default, client components only for interactive islands.
- Every user-facing string lives in the i18n catalog, in **both** English and
  Spanish. No em dashes in user-facing text.
- Keep the **public/adapter split**: public packages depend only on ports
  (`EmailProvider`, `SubmissionDestination`, the DB factory). Concrete third-party
  adapters are wired by configuration, never imported by public code.

## Reporting bugs / requesting features

Use the issue templates. For security issues, **do not open a public issue**: see
[`SECURITY.md`](SECURITY.md).
