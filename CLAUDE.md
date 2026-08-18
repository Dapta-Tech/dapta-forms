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

## Typography: no em dashes

Dapta Forms does not use the em dash. It is the most reliable tell that a string
was drafted by a language model rather than written by a person, and an interface
full of them reads as machine-made. Use a comma, a colon, a semicolon,
parentheses, or two sentences. Do not reach for a bare ASCII hyphen: a hyphen
between clauses reads as a typo, not as punctuation.

**Banned, everywhere:**

| Char | Codepoint | Name |
|---|---|---|
| `—` | U+2014 | em dash |
| `―` | U+2015 | horizontal bar |

**Allowed only as a range operator**, never as sentence punctuation:

| Char | Codepoint | Yes | No |
|---|---|---|---|
| `–` | U+2013 | `0–100`, `2–10`, `{min}–{max}`, `$500–$2,000` | `Saved — try again` |

`−` (U+2212) is for arithmetic only, and only where a real minus sign is meant
(a negative number on screen). Write ASCII `-` in code.

**`─` (U+2500) is NOT a dash.** It draws the section banners in the CSS and in the
larger components, ~830 of them. Any regex you write must name U+2014 and U+2013
explicitly. A character class like "all Unicode dashes" destroys every banner in
the repo, and `/* ── Main area — everything below ── */` needs the middle
character replaced and the outer two left alone.

### Hard ban vs advisory

**Hard ban, in anything a person outside the team reads:**

- **Every frontend component in `apps/web`.** Text typed straight into JSX is
  copy, exactly like a catalog entry, and it is the easiest kind to miss because
  it belongs to no catalog and no reviewer greps for it. That includes the text
  between tags, the attributes a person or a screen reader hears (`title`,
  `aria-label`, `alt`, `placeholder`), and any string literal in the component.
  This is not hypothetical: the webhook health cell shipped a bare `—` as its
  empty state, hardcoded in JSX, and no gate saw it. Prefer a catalog key over
  hardcoded text anyway (invariant 8), but a dash in a component is a hard ban
  whether or not the string should have been in the catalog.
- Both message catalogs. There are two: `packages/shared/src/i18n/index.ts` and
  `apps/web/app/admin/forms/[id]/edit/_components/builder-messages.ts`. A sweep
  that only knows about the first one misses a third of the UI copy.
- Copy shipped as string literals: email subjects and bodies
  (`packages/notifications/src/templates.ts`), seed and template form content
  (`packages/db/src/demo-form.ts`, `packages/db/src/templates/*`,
  `packages/db/src/seed.ts`), builder templates
  (`apps/web/app/admin/forms/[id]/edit/_components/templates.ts`), OpenAPI
  descriptions (`apps/api/src/openapi.ts`), CRM payload text
  (`packages/destinations/src/adapters/*`).
- Page metadata: `title`, `description`, OpenGraph, `alt`, `aria-label`,
  `placeholder`. A screen reader announces an em dash separator out loud.
- Anything thrown, logged, echoed, or returned as an error `reason`. The
  integrations panel renders delivery failures verbatim, so an `OutboxSkipError`
  message is on-screen copy.
- Every `.md` at the repo root and in `docs/`, `README.md`, `NOTICE`, every
  `package.json` `description`, and **every file in `.changeset/`**. Changesets
  become the public CHANGELOG and cannot be revised afterwards.

**Advisory in code comments and test titles.** Do not write new ones. Do not open
a PR that only rewrites old ones: that is ~1,500 lines across ~240 files, it
collapses 137 commits' worth of `git blame` on the most explanatory lines in the
repo, and roughly half the rewrites read no better than the original. Clean them
when you are already editing the surrounding lines. If a sweep is ever done
anyway, add `.git-blame-ignore-revs` in the same PR.

**Exempt:** `packages/db/migrations/**`. Migrations are append-only, so a comment
there is frozen history rather than editable prose.

### Traps that have already bitten

- **Two dashes are written as the escape `—`**, not as the glyph. A search
  for the literal character reports those strings clean when they are not.
- **`admin.submissions.na` WAS the single character `'—'`**, the empty-cell
  fallback in the submissions table, and a rule like `s/\s*—\s*/, /` turned
  every empty cell into `, `. It is `''` now: the table draws row borders, so an
  empty cell already reads as empty. The webhook health cell had the same glyph
  hardcoded in JSX and got the same treatment.
- **`admin.integrations.autosavedPartial` ENDED with a dash** used as a joiner:
  the caller does `` `${m.autosavedPartial} ${detail ?? ''}`.trim() ``. Only a
  period was safe there; a trailing comma or colon breaks the no-detail branch.
- **An error message thrown from a package can be on-screen copy.**
  `ONE_HUBSPOT_DESTINATION_MESSAGE` lives in `packages/types`, is returned as an
  API error `message`, and `question-hubspot-actions.ts` hands it to the editor
  verbatim. Grep for where a message SURFACES, not for where it is defined.
- **A JSDoc that quotes a UI string goes stale on its own schedule.** One read
  `"Logic {emdash} {question}"` long after the copy became `"Logic: {question}"`,
  so the comment was the only dash left and it documented copy that no longer
  existed.
- **Spanish uses tight spacing** (`—UTMs, … envío—`) where English spaces the
  dash. A regex written as `/ — /` half-fixes the catalog and leaves `es` dashed.
- **Seven hits sit between placeholders with no whitespace** (`{min}–{max}`). A
  whitespace-anchored regex misses all of them; a greedy one turns a range into
  a list and nothing catches it, because both are valid strings.
- **The `es` catalog is already ~22% cleaner than `en`.** Someone started this
  pass and stopped. Where a Spanish string is already dash-free, it is the spec
  for the English rewrite, not the other way round. Never "restore parity" by
  re-adding a dash to `es`.
- **The compiler cannot catch any of this.** `FormsMessages` enforces key parity,
  not value parity, so `tsc` stays green whether you fix one locale or both.

### Check before you push

```bash
bash scripts/dash-check.sh
```

The check has three scopes, because the three live at different counts.

**Components block, on the whole tree, always.** Every `.ts`/`.tsx` under
`apps/web/app`, `apps/web/components` and `apps/web/lib` is read as a WHOLE LINE
once comments are removed, so JSX text and `title`/`aria-label`/`alt` attributes
are covered, not just quoted strings. Those files were uncovered until the gate
had already let a hardcoded `—` reach the screen.

Reading whole lines is what forces the block-comment state machine in the
script: a `{/* ... */}` continuation line starts with neither `*` nor `//`, so
no per-line filter can tell it from copy, and roughly 140 comment lines in
`apps/web` look exactly like on-screen text without it.

**Copy blocks, on the whole tree, always.** The string catalogs, email
templates, seed and template form content, OpenAPI descriptions and CRM payload
text are at zero occurrences and stay there. Only QUOTED text counts in these,
because their comments outnumber their strings about five to one.

**Docs block only on the lines a PR adds.** `.changeset/` and `docs/` carry
roughly 320 older dashes, most of them in changesets that already shipped as
public CHANGELOG entries and cannot be revised. A whole-tree gate on those could
never be switched on, so CI passes the PR's base and the script charges the PR
for what it adds. The count falls on its own; nobody has to sweep 320 lines
first. Run it with a base to see exactly what CI will say:

```bash
bash scripts/dash-check.sh origin/develop
```

**The release PR (`develop` into `main`) is charged for everything develop
added since the last release**, not for one feature. A dash that reached
develop before this gate ran on PRs (or through a merge nobody re-checked) is
invisible on every feature PR and fails only on the release, where the fix is
a detour: a second PR into develop, then the release re-runs. It happened on
2026-08-18 with `.changeset/iam-workspaces.md` (merged one PR before the CI job
existed). So, before opening the release PR, run the check with main as the
base and fix what it reports in a small PR to develop first:

```bash
bash scripts/dash-check.sh origin/main
```

And when you write a changeset, remember it is the one file the whole-tree
copy scan does NOT read (it is docs scope, diff-only): the base rule above,
"no em dash in anything a person outside the team reads", is the only thing
keeping it clean, and it becomes the public CHANGELOG the moment it ships.

**What the check does NOT read: comments and `*.spec.ts` titles.** Both are
advisory per the rule above, in every scope, so a dashed code comment or test
title will never fail CI. That is a deliberate ceiling, not an oversight: the
repo holds ~1,500 dashes in comments, and a gate that blocked on them would be
switched off in a week. It also means the check is not a substitute for reading
your own diff.

Two more things it cannot see. `apps/api` route handlers are only covered where
a string is a known copy path, so a message you invent and return as an error
`reason` can still reach the integrations panel unchecked. And no static gate
reaches copy that is already PERSISTED: form configs and saved notification
templates carry their text in stored JSON, where only a migration can fix it. Note what is deliberately NOT done there: code spans are
stripped before matching in docs but never in code, because stripping them in
code would erase template literals, and a dashed template literal is copy.

**Write the pattern as an alternation, never as a bracket class.** CI runs with
`LANG` unset, and in the C locale grep degrades a bracket class of multi-byte
characters into the set of their bytes. `[emdash horizontalbar]` becomes
`{E2,80,94,95}` and matches every General Punctuation character, since they all
begin with byte `E2`. That reported arrows, typographic apostrophes, ellipses
and bullets as em dashes: 260 false positives out of 586, which is why the check
sat outside CI for a while.

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

**Add a question type, end-to-end** (order matters; the `url` type is a complete,
recent example of every stop on this list):
1. `packages/engine/src/form-logic.ts`: add to `FORM_FIELD_TYPES`; add branches in
   `validateAnswer` + `validateAnswerCode` (and a new `ValidationCode` member if the
   type fails in a new way); extend `computeScore` if it is scored; if the stored
   value must have a canonical shape, teach `canonicalizeAnswer` about it (the
   renderers call it at their commit points, right before `validateAnswerCode`).
   `packages/types` re-exports the enum into `formStepSchema.type`, so it needs no
   edit unless the type carries new step fields.
2. `packages/engine/src/form-config.ts`: per-type defaults in `createEmptyStep`.
3. `packages/shared/src/i18n/index.ts`: any new `renderer.errors.*` code, in
   **both** `en` and `es` (the renderers' `err(code)` indexes the catalog by the
   validation code, so the key must match it exactly). `admin.editor.types` in that
   catalog is nearly dead: only `types.slider` is read (a settings-section
   heading), so a new type needs no entry there unless its settings section
   reuses one.
4. Builder, all under `apps/web/app/admin/forms/[id]/edit/_components/`:
   `question-types.ts` (`GALLERY` entry + `iconForStep`), `builder-messages.ts`
   (`GalleryItemId` union + `gallery.items` in `en` and `es`; the Record type
   forces both), `question-settings.tsx` (`PLACEHOLDER_TYPES` if the public input
   renders `step.placeholder`, plus any type-specific settings section),
   `canvas-question.tsx` (the WYSIWYG preview branch), `logic-map.tsx`
   (`galleryIdForStep`, or the Logic node is labelled "Short text"),
   `advanced-settings.tsx` (`sample()` for the prefill URL example).
5. `apps/web/components/public/step-input.tsx`: add a `case` to the render switch.
   There is no `<form>` element in the renderers, so native input validation never
   fires; the engine's validator is the only gate.
6. `apps/web/app/admin/forms/[id]/integrations/auto-map.ts`: a `suggestProperty`
   shortcut if the type maps to an obvious HubSpot contact property; and
   `apps/api/src/integrations.controller.ts` `sampleAnswers`, so the mapping
   preview and the webhook test body show a value of the right shape.
7. Tests: `packages/engine/src/form-logic.spec.ts` (+ `form-config.spec.ts`),
   `apps/web/components/public/step-input.spec.tsx`,
   `apps/web/app/admin/forms/[id]/integrations/auto-map.spec.ts`.
8. A changeset for `@quill/engine` (and `@quill/shared` if the catalog changed).

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
