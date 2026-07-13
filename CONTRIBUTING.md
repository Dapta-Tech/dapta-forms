# Contributing to Quill (Dapta Forms)

Thanks for your interest! Quill is built to be easy to hack on — clone-and-run
with zero infrastructure.

## Getting started

```bash
pnpm install
pnpm dev        # SQLite is created + seeded automatically
```

Requirements: Node ≥ 20, pnpm ≥ 10. That's it — no Docker or database needed.

## Repository layout

See the architecture diagram in [`README.md`](README.md). In short: `apps/{web,api}`
plus `packages/{engine,db,notifications,shared,config,types}`, a Turborepo +
pnpm-workspaces monorepo.

## Making a change

1. Create a branch off `main`.
2. Make your change with a test. Run:
   ```bash
   pnpm typecheck && pnpm lint && pnpm test
   ```
3. If your change affects a published package's behavior, add a changeset:
   ```bash
   pnpm changeset
   ```
4. Commit with a **Conventional Commit** message and a **DCO sign-off** (below).
5. Open a PR. CI runs lint, typecheck, tests on **SQLite** and a **Postgres**
   parity job (which exercises the submission-integrity unique-index path), builds both
   apps, and runs the publish-gate secret scan.

## Commit conventions

- **Conventional Commits**: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`,
  `chore:`, … (enforced by commitlint).
- **DCO sign-off** — we use the [Developer Certificate of Origin](https://developercertificate.org/),
  not a CLA. Sign every commit:
  ```bash
  git commit -s -m "feat: add …"
  ```
  This appends a `Signed-off-by:` line certifying you wrote the code (or have the
  right to submit it). A CI check enforces it.

## Code style

- TypeScript strict. Validate untrusted input with **zod** at every boundary.
- Prettier owns formatting (`pnpm format`).
- Frontend: semantic Tailwind theme tokens only (no arbitrary values / raw hex),
  RSC by default, client components only for interactive islands.
- Keep the **public/adapter split**: public packages depend only on ports
  (`EmailProvider`, the DB factory). Concrete third-party adapters are wired by
  configuration, never imported by public code.

## Reporting bugs / requesting features

Use the issue templates. For security issues, **do not open a public issue** —
see [`SECURITY.md`](SECURITY.md).
