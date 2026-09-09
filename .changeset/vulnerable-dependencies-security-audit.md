---
'@quill/notifications': patch
'@quill/db': patch
'@quill/web': patch
---

Patch known-vulnerable dependencies found in a security audit of the dependency tree.

`pnpm audit --prod` flagged 35 advisories (16 high, 17 moderate, 2 low) across direct
and transitive dependencies. None had a working exploit path in this codebase today —
verified case by case below — but several close real vectors that a future change
could reopen, so they're patched now rather than left as latent risk:

- **`drizzle-orm` 0.38.2 → 0.45.2** — closes GHSA-gpj5-g38j-94v9, a SQL injection via
  `sql.identifier()` / `.as()`. Quill never calls either (`grep` confirmed), so this is
  preventive, not a fix for an active bug.
- **`nodemailer` 6.9.16 → 9.0.5** — closes several advisories, including a high-severity
  one where the `raw` sendMail option bypasses `disableFileAccess`/`disableUrlAccess`.
  The SMTP adapter (`packages/notifications/src/adapters/smtp.ts`) only sets standard
  fields, never `raw`. `@types/nodemailer` bumped to `^8.0.1`, the newest published —
  nodemailer 9.x ships no bundled types yet; `build:packages` passes clean against it.
- **`next` 16.2.10 → 16.2.11** — closes four moderate advisories: DoS via invalid UTF-8
  request bodies, unbounded Server Action payload size, SVG image-optimization DoS, and
  disclosure of an internal Server Function endpoint.
- **Transitive pins via `pnpm-workspace.yaml` overrides** (the direct dependency hasn't
  bumped its own range yet): `multer >=2.2.0`, `body-parser >=1.20.6`,
  `postcss >=8.5.23`, `file-type >=21.3.2`, `qs >=6.15.2` — mostly DoS-class advisories
  in request/body parsing and file-type sniffing.

Deliberately **not** included: `@nestjs/core` (GHSA-36xv-jgw5-4q75, needs >=11.1.18) is
still open. The fix is a v10→v11 NestJS major, out of scope for a dependency-patch PR —
tracked separately. `pnpm audit --prod` goes from 35 findings to that one, documented
exception.

`pnpm run build:packages`, `pnpm run typecheck`, and `pnpm run test` (979 tests) all
pass unchanged.
