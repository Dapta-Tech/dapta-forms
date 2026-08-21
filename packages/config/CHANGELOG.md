# @quill/config

## 0.1.0

### Minor Changes

- b8322ea: First-run onboarding wizard, behind `ONBOARDING_WIZARD` (**default on**).

  A brand-new workspace is asked three questions — role, industry, and what they
  want to use Forms for — and then picks the template its first form is built from,
  replacing the demo form that used to be seeded for everyone. The two are mutually
  exclusive by construction: the seed only writes into an account with zero forms,
  so `ONBOARDING_WIZARD` suppresses it rather than relying on operators to switch
  both correctly.

  > **Upgrading a self-hosted deployment:** because the flag defaults to on, this
  > release also turns `SEED_DEMO_FORM` inert — a new workspace gets the wizard and
  > the template it picks, not the seeded demo form. Set `ONBOARDING_WIZARD=false`
  > to keep the previous behaviour.
  - `@quill/types`: `accountOnboardingSchema` and the answer enums, the template id
    union, and the use-case → template mapping.
  - `@quill/db`: migration 0011 (`account.onboarding`, `account.onboarding_completed_at`,
    backfilled so accounts that predate the wizard are never sent through it), the
    progress/claim repository, and four form templates.
  - `@quill/shared`: `admin.onboarding.*` copy in English and Spanish.
  - `@quill/config`: the `ONBOARDING_WIZARD` flag.

  Progress is written on every step advance, not only at completion, so an
  abandoned onboarding leaves a record — `account.onboarding.lastStep` joins to the
  first-touch tags already on `account.attribution`, which makes drop-off per
  campaign a single query.

- 7b087af: Cohort-aware onboarding wizard + Dapta-estate sync.

  - `@quill/types`: the onboarding blob and steps grow `phone`, `crm`,
    `lead_volume`, `lead_source`, a `cohort` (`cold`/`dapta`) and per-answer
    `sources`; the industry enum becomes the IAM's 52-value bank.
  - `@quill/db`: migration 0012 rewrites stored industry answers to the new
    bank (a stale enum value would otherwise take the whole blob down on read);
    new outbox kind `dapta_sync`.
  - `@quill/shared`: EN/ES copy for the new questions.
  - `@quill/config`: optional `IAM_BASE_URL`, `IAM_API_KEY`,
    `DAPTA_SYNC_FLOW_URL`, `DAPTA_SYNC_FLOW_KEY` (all unset = feature off).

- 1e4b762: Load the deployment's own GTM container on platform pages — login, onboarding,
  and the admin dashboard — never on a public form page.

  The marketing site already carries the container; the platform lives on a
  different domain, so until now the funnel went dark the moment someone crossed
  from the landing to the product. `PlatformGtm`
  (`components/analytics/platform-gtm.tsx`) closes that gap from the three
  platform entry points, reusing `buildGtmSnippet` and the noscript iframe shape
  from the public-page tracking module.

  The boundary is the same one `ProductAnalytics` already draws, for the same
  reason: a public form page's visitor is a form owner's respondent, and that page
  may already carry the OWNER's GTM container via `NEXT_PUBLIC_GTM_ID` / per-form
  config. Loading ours beside it would cross-fire both containers through the
  shared `dataLayer` and file a customer's traffic under our marketing account —
  which is also why the Script id (`platform-gtm`) differs from `tracking-gtm`:
  next/script dedupes by id, and the two must never suppress one another.

  Configured by the new `NEXT_PUBLIC_PLATFORM_GTM_ID` (client env schema,
  `@quill/config`). Resolution is server-side at request time — every mount point
  is a dynamic route — with a fallback that keeps both standing invariants true at
  once: on an `AUTH_PROVIDER=workos` build (every Dapta deployment) a missing env
  var falls back to Dapta's own container in code, so the platform cannot ship a
  silent no-op the way a missing build-time `NEXT_PUBLIC_` once did; anywhere else
  (every bare fork) it resolves to nothing, and the fork keeps making zero
  third-party requests.

- 72a7876: Product analytics plumbing (no events emitted yet). Adds `attributionSchema` to @quill/types (the contract for the first-touch acquisition blob that migration 0010 persists on `account.attribution`), an `analytics` outbox kind, and the `PRODUCT_ANALYTICS_KEY` / `NEXT_PUBLIC_PRODUCT_ANALYTICS_KEY` env pair (plus hosts). Server-side events enqueue through the outbox and drain with retry/backoff — never inline, because the most important event fires on the public submission path. The browser half loads only on the admin dashboard, identifies by email, and registers `product: 'forms'` plus a `forms_account` group as super properties. Deliberately NOT named `NEXT_PUBLIC_POSTHOG_*`: those already exist and belong to the form owner's own pixels on their public form page. Unset (the default) = fully off, so a bare fork makes zero third-party requests.
- c265f0f: Type-to-find in the workspace switcher, and estate-wide access for the
  deployment's staff.

  - The switcher's menu has a search box (from six workspaces, or always for
    staff): typing filters your own workspaces instantly. Own workspaces list
    first; the ones you hold by access grant carry a Staff badge.
  - `IAM_STAFF_DOMAINS` (comma-separated email domains; unset = nobody, every
    fork) names the deployment's staff. With the identity service configured,
    a person on one of those domains ALSO searches the whole estate, the way the
    Dapta app's sidebar does (`GET /workspace/search?query=`), and can enter any
    workspace of it. Nothing is projected by looking: entering one re-reads the
    workspace upstream, projects it (no onboarding stamp, no demo form, no signup
    event) and mints an `admin` row marked `member.access_grant = 'staff'`.
  - Migration 0016: `member.access_grant` (nullable). Grant rows are excluded
    from rosters and member counts (a customer's team list never shows staff),
    never send the wizard to the staff member, are never pruned by the
    membership projection, and turn into a real membership the moment upstream
    names the person. "First member" (demo form, signup) counts real memberships
    only, so an account a grant created ahead of its owner still welcomes the
    owner.
  - API: `GET /v1/workspaces/search?q=&page=`, `POST
/v1/workspaces/estate/:workspaceId/enter`; `/v1/me` carries `staff` and
    `accessGrant`.
