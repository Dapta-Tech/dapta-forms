---
'@quill/web': patch
---

Mirror the onboarding wizard's screen into the URL as `/onboarding?step=N`.

The wizard was a single unchanging URL, so page-level analytics saw one visit
where six questions happened. Every move now stamps `?step=N` — 1-based,
counting exactly like the on-screen "Question 1 of N", with the template picker
as the final step — which is the same URL shape the Dapta adminpanel gives its
onboarding, so one GTM history trigger reads both products' funnels the same
way.

Three deliberate mechanics:

- **Native `history.pushState`, never `router.push`.** The router would re-run
  the server page — `me()` plus the IAM cohort probe — on every answer, for a
  screen whose state lives entirely in the client component. The first screen is
  a `replaceState`, so question one and the bare `/onboarding` are a single
  history entry and browser-back from it still exits the wizard.
- **popstate moves the wizard, not just the URL.** The adminpanel pushes
  `?step=` but never listens, so its back button walks the address bar while the
  screen stays put. Here back/forward land on the clamped real screen
  (`stepIndexFromSearch`), and the step-viewed analytics stay honest because the
  arrival effect was already keyed on seen steps.
- **A direct `?step=N` load is normalized server-side.** Answers only live in
  client state — a reload restarts at question one regardless — so the page
  redirects stale deep links to the bare path rather than letting the URL lie to
  analytics, and the wizard re-stamps `?step=1` itself. The redirect runs after
  the existing gates, so someone already onboarded still exits to `/admin` in
  one hop.

The pure halves (`stepParam` / `stepIndexFromSearch`) live in `lib/onboarding.ts`
with unit specs; `qa/e2e/v11-onboarding-step-url.spec.ts` pins the three history
writers against a real browser.
