# First-run onboarding

How a brand-new account goes from "just signed up" to "editing their first
form", what gets recorded along the way, and how to measure where people give
up. This documents the wizard shipped behind `ONBOARDING_WIZARD` (default
**on**).

The short version:

```
signup → /admin → (onboarding owed?) → /onboarding
           ↑                               │
           │            Q1 role → Q2 industry → Q3 use case → template picker
           │                               │ (every advance PATCHes progress)
           │                               ▼
           └──────── redirect ←── POST complete (claim, once)
                       to /admin/forms/<id>/edit?tour=1
```

## 1. The gate

An account **owes onboarding** when both are true:

- `ONBOARDING_WIZARD` is on (`packages/config/src/env.ts`), and
- `account.onboarding_completed_at` is `NULL`.

The API folds both into one field — `onboardingRequired` on `GET /v1/me`
(`apps/api/src/admin.service.ts`) — and the web app **never re-derives it**;
there is exactly one copy of the rule.

Routing runs in both directions, which is what makes every URL safe to hit
directly, bookmarked or back-buttoned:

- `apps/web/app/admin/layout.tsx` → redirects to `/onboarding` when
  `onboardingRequired`.
- `apps/web/app/onboarding/page.tsx` → redirects to `/admin` when it is NOT.

`/onboarding` deliberately lives **outside** `/admin`: a child route would
re-enter the admin layout, be redirected again, and loop. It also gets none of
the admin chrome — there is no sidebar to wander into before a first form
exists.

**Existing accounts never see the wizard.** Migration 0011 backfills
`onboarding_completed_at = created_at` for every account that predates it, so
only genuinely new accounts are gated. (Using `created_at` rather than `now()`
also keeps "completed before the feature shipped" legible in the data instead
of inventing a spike of completions on deploy day.)

## 2. The wizard

`apps/web/app/onboarding/wizard.tsx` — three questions, then a template picker.

| # | Step key | Field | Input | Options |
|---|----------|-------|-------|---------|
| 1 | `role` | `role` | choice list (2-col grid) | 9 roles (`ONBOARDING_ROLES`) |
| 2 | `industry` | `industry` | searchable dropdown | `ONBOARDING_INDUSTRIES` |
| 3 | `use_case` | `useCase` | icon cards | 5 (`ONBOARDING_USE_CASES`) |
| 4 | `template` | `template` | template cards + CTA | 5 (`FORM_TEMPLATE_IDS`) |

Design decisions that are load-bearing:

- **The wizard IS a Dapta form, not a page that resembles one.** It renders
  through the public renderer's own shell (`.pf`) and `StepInput`
  (`apps/web/components/public/step-input.tsx`), and each question is a real
  `FormStep` (`apps/web/lib/onboarding.ts`). The first screen a new user sees
  demonstrates the product they signed up for — and it cannot drift from real
  forms, because a change to the renderer changes this screen too. The only CSS
  is the delta in `apps/web/app/onboarding/onboarding.css`, scoped under `.ob`.
- **No skip on the questions.** They are three taps; a skippable answer is an
  answer most people skip. The honest way out is the template screen's "start
  from scratch".
- **Choosing IS continuing** — selecting an option advances; there is no
  Continue button until the template screen.
- **The use-case answer pre-selects a template** (`USE_CASE_TEMPLATE` in
  `@quill/types`), badge "Recommended for you". Going back and changing the use
  case clears an explicit pick so two cards can never disagree.
- Enums live in `@quill/types`; copy lives in the i18n catalog
  (`packages/shared/src/i18n/index.ts`, EN + ES); glyphs live beside the
  question bank keyed by enum so a new value cannot ship without one.

## 3. Templates

`packages/db/src/templates/` — one entry per `FormTemplateId`, exhaustive by
construction (`Record<FormTemplateId, FormTemplate>`; a new id without a
template is a compile error).

| id | Name | Config |
|----|------|--------|
| `lead-qualifier` | Lead qualifier | scored questions, hot/warm outcomes |
| `customer-feedback` | (the old demo form) | NPS-style survey — reused, not rewritten |
| `event-registration` | Event registration | attendee capture |
| `application` | Applications and requests | inbound work intake |
| `blank` | Untitled form | `config: null` → the API's own "new form" default |

**The config never crosses the wire.** The web posts a template *id*; the API
resolves it against this registry (`getFormTemplate`), so the onboarding path
cannot be used to inject an arbitrary form config.

## 4. Persistence — two writes, different jobs

`packages/db/src/onboarding.ts`. Both live on the `account` row (migration
`0011_onboarding.sql`, both dialects, additive):

- `account.onboarding` (JSON) — `{ version, role, industry, useCase, template,
  lastStep, stepsSeen[], startedAt }` (`accountOnboardingSchema`).
- `account.onboarding_completed_at` (epoch-ms) — the completion claim, indexed.

**Write 1: `saveOnboardingProgress` — on EVERY advance.** This is what makes an
abandoned onboarding leave a trace. `lastStep` names the screen being
**reached**, not the one answered — so the stored value is a drop-off bucket: a
row with `lastStep: 'industry'` and no `completed_at` is someone who answered
the role question and quit on industry. The wizard also claims the very first
screen on arrival (`lastStep: 'role'`), otherwise "opened and quit immediately"
is indistinguishable from "never arrived".

The client action (`apps/web/app/onboarding/actions.ts`) **never throws into
the wizard**: a failed save advances anyway. Losing one breadcrumb of telemetry
beats trapping a person on question two because the network blipped.

**Write 2: `claimOnboardingComplete` — once.** `UPDATE … WHERE
onboarding_completed_at IS NULL`: exactly one caller wins, so the first form is
created once and `forms_onboarding_completed` fires once even on a double-click or a
second tab. A loser is handed the winner's form id and lands on the same form.
Both writes guard on the claim, so a stale PATCH after completion can never
rewrite a finished onboarding's answers.

After the claim wins, the API creates the form from the template
(`apps/api/src/admin.service.ts#completeOnboarding`) and the web redirects to
`/admin/forms/<id>/edit?tour=1` — the query param (never a cookie) arms the
builder's coach marks exactly once. A failed form-create does **not** un-claim
completion: the answers are stored, and the person lands on the dashboard where
"New form" is the obvious next click.

## 5. Interaction with the demo seed

`SEED_DEMO_FORM` (default on) auto-seeds a demo form into brand-new accounts —
but **only into accounts with zero forms**. While `ONBOARDING_WIZARD` is on it
**suppresses the seed** (`maybeSeedDemoForm` in
`apps/api/src/auth.provider.ts`), and must: a demo seeded at first login would
make the account non-empty and the wizard's template form could never be
created. The two features are mutually exclusive by construction, not
convention.

Wanted side effect: with the wizard on, someone who abandons keeps **zero
forms** — abandonment is a fact the database can see. A demo seeded for
everyone would make that state invisible.

## 6. Analytics

**Every event name carries a `forms_` prefix**, added inside `captureEvent`
(`apps/web/lib/product-analytics.ts`) and never at the call site — the analytics
project is shared with the rest of Dapta, where `start_onboarding` and
`dof_onboarding_*` already exist and mean something else entirely. Querying
PostHog for the unprefixed name returns zero rows.

Client events (`apps/web/app/onboarding/wizard.tsx` via `captureEvent`):

| Event | When | Properties |
|-------|------|------------|
| `forms_onboarding_started` | wizard first opens | `locale` |
| `forms_onboarding_step_viewed` | once per screen **arrival** (ref-guarded — not per render, and StrictMode-safe) | `step_key`, `step_index`, `total_steps` |
| `forms_onboarding_step_answered` | each answer | `step_key`, `step_index`, `value` |
| `forms_onboarding_template_picked` | template card chosen | `template`, `recommended`, `use_case` |

Server event (`apps/api/src/admin-crud.controller.ts`):

| Event | When | Properties |
|-------|------|------------|
| `forms_onboarding_completed` | the claim's **winner** only | `template`, `form_id` |

The builder tour that follows emits `forms_onboarding_tour_step` (per coach
mark) and `forms_onboarding_tour_finished`, so the funnel can run past the
wizard into the first minute of the builder.

**The server event carries no `account_code`.** Client events are enriched by
the browser SDK's registered identity (`account_code`, `account_id`,
`member_id`, `role`); the server event is a bare `captureForMember` call and
carries only `product`, `template`, `form_id` — plus the `forms_account` group
and the member's email as `distinct_id`, which both halves share. An insight
filtered on the `account_code` **property** therefore drops the conversion
event silently. Filter by the `forms_account` group instead; that is what every
event has.

Completion is counted server-side on purpose: it counts **accounts that
finished**, not browsers that reached the last screen — a retry cannot
double-count and a closed tab cannot miss.

All events carry the `forms_account` group, whose identity includes the
account's signup **attribution (UTMs)** — so every onboarding funnel in PostHog
can be filtered or broken down by campaign. Anything counting conversions must
read the server event, never infer it from client events.

## 7. Measuring drop-off without PostHog

`account.onboarding` and `account.attribution` are the **same row**, so
drop-off per campaign is one GROUP BY, no new plumbing:

```sql
-- Where do people quit? (accounts created since the wizard shipped)
SELECT onboarding->>'lastStep' AS last_step, COUNT(*)
FROM account
WHERE onboarding_completed_at IS NULL AND onboarding IS NOT NULL
GROUP BY 1 ORDER BY 2 DESC;

-- Completion rate by campaign
SELECT attribution->>'utm_campaign' AS campaign,
       COUNT(*) FILTER (WHERE onboarding_completed_at IS NOT NULL) AS completed,
       COUNT(*) AS started
FROM account
WHERE onboarding IS NOT NULL
GROUP BY 1;
```

(Postgres syntax; `onboarding_completed_at` is BIGINT epoch-ms and reads back
as a string through node-postgres — the DB layer coerces at the read site.)

## 8. Operations

- **Rollout gate = the deploy pipeline.** develop auto-releases to dev; prd is
  a manual promotion. The flag's default is **on**, so no configmap change is
  needed anywhere on the happy path.
- **Kill switch:** set `ONBOARDING_WIZARD=false` in the environment's
  configmap. `onboardingRequired` reads false for everyone, so anyone
  mid-wizard is simply let into `/admin` on their next request; their stored
  answers stay on the row (`completed_at` stays NULL). If the flag comes back
  on later, those accounts resume being gated and the wizard restarts.
- **Forks / self-hosters:** `ONBOARDING_WIZARD=false` + `SEED_DEMO_FORM=true`
  restores the pre-wizard behaviour exactly.

## 9. File map

| Concern | Where |
|---------|-------|
| Flag | `packages/config/src/env.ts` (`ONBOARDING_WIZARD`) |
| Gate (API) | `apps/api/src/admin.service.ts` (`onboardingRequired`) |
| Gate (web, both directions) | `apps/web/app/admin/layout.tsx`, `apps/web/app/onboarding/page.tsx` |
| Wizard UI | `apps/web/app/onboarding/wizard.tsx` + `onboarding.css` (`.ob` delta over the renderer) |
| Question bank | `apps/web/lib/onboarding.ts` |
| Server actions | `apps/web/app/onboarding/actions.ts` |
| API endpoints | `PATCH /v1/account/onboarding`, `POST /v1/account/onboarding/complete` (`apps/api/src/admin-crud.controller.ts`) |
| Persistence | `packages/db/src/onboarding.ts`, migration `0011_onboarding` (pg + sqlite) |
| Templates | `packages/db/src/templates/` |
| Seed suppression | `apps/api/src/auth.provider.ts` (`maybeSeedDemoForm`) |
| Enums + schemas | `packages/types/src/index.ts` (`ONBOARDING_*`, `accountOnboardingSchema`, `USE_CASE_TEMPLATE`) |
| Copy (EN/ES) | `packages/shared/src/i18n/index.ts` (`admin.onboarding`) |
| Builder tour | `apps/web/app/admin/forms/[id]/edit/_components/builder-tour.tsx` (`?tour=1`) |
| Tests | `packages/db/src/onboarding.spec.ts`, `packages/db/src/templates/templates.spec.ts`, `apps/api/src/onboarding.controller.spec.ts` |
