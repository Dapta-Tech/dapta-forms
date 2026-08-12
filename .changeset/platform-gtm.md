---
'@quill/config': minor
---

Load the deployment's own GTM container on platform pages — login, onboarding,
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
