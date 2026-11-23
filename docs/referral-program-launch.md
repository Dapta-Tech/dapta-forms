# Referral program: launch checklist

For the operator who turns the dForms referral program on in production. Every
step is configuration; the code is already merged. Background:
[ADR 0005](adr/0005-referral-state-is-keyed-by-person.md), the env reference in
[SELF-HOSTING.md](../SELF-HOSTING.md) and [.env.example](../.env.example).

## 1. Before you start

- [ ] The API image includes migrations `0030` to `0033` (`referrer`, `referral`,
      `account.hide_attribution_chosen_at`, `referral_invite`). They are additive;
      the API's normal migrate step applies them.
- [ ] Local smoke test passes:
      `REFERRAL_PROGRAM=true bash qa/dev-sqlite.sh`, then in another shell
      `npx playwright test -c qa/playwright.config.ts qa/e2e/v21-referral-happy-path.spec.ts --reporter=list`.

## 2. Deployment env

API (runtime env, read once at boot, so a change needs a restart):

| Var | Value | Why |
|---|---|---|
| `REFERRAL_PROGRAM` | leave unset | Unset, the program is on wherever the identity service runs (`AUTH_PROVIDER=workos` with `IAM_BASE_URL`), so dev and prod need nothing. `false` turns it off. |
| `REFERRAL_CAMPAIGN_ENDS_AT` | the end, ISO 8601 with a zone, e.g. `2027-01-31T23:59:59-05:00`; or unset for no end | Ends the banner and the reminder email. A value without a zone refuses to boot. |
| `NEXT_PUBLIC_LANDING_URL` | `https://dforms.ai/` | The API builds the link `<landing>/?ref=<code>`. It must be in the API env, not only the web build arg. Unset, links fall back to `PUBLIC_APP_URL` and skip the landing greeting. |
| `PUBLIC_APP_URL` | the app's public URL (already set) | Fallback link base. With neither URL set the program stays off. |
| `OUTBOX_WORKER_ENABLED` | `true` on at least one replica (default) | Sends the referral emails. |
| `EMAIL_PROVIDER` | the real provider (already set) | `log-only` only prints the emails. |
| `PRODUCT_ANALYTICS_KEY` | the PostHog project key (already set) | Server events (`forms_referral_signup`, `forms_referral_unlocked`). Unset, nothing is sent. |
| `CORS_ORIGINS` | no change | The landing reads the first name through its own proxy (section 3), so `https://dforms.ai` and `www` do not need to be listed. Add them only if a page ever calls `GET /v1/public/referrals/{code}` from the browser. |

Web: nothing new. It reads the program from `/v1/me.referral`.

Check after the deploy:

- [ ] `GET /v1/me` for a signed-in person returns `referral.enabled: true` and a
      `referral.link` that starts with `https://dforms.ai/?ref=`.
- [ ] The left menu shows "Invite friends 0/5" and the top banner shows.

## 3. Landing (`dapta-forms-landing`, T09)

- [ ] Branch `feat/referral-landing` is merged and deployed.
- [ ] Pages env var `FORMS_API_URL`: leave unset in production. The proxy
      `functions/invite/[code].js` (`GET /invite/<code>`) then calls
      `https://api.dforms.ai/v1/public/referrals/<code>`. For a preview, set
      `FORMS_API_URL` to that environment's API origin.
- [ ] Open `https://dforms.ai/?ref=<a real code>`: the greeting shows the
      referrer's first name, and every app link on the page carries `ref`.

## 4. PostHog (project 21405)

Recordings must not store emails or tokens. In Project settings, Session replay:

- [ ] Turn ON masking of all inputs ("Mask all inputs").
- [ ] Turn OFF header capture in network recording ("Capture headers"; leave
      body capture off too).
- [ ] Open one new recording of the app and check that the email field and the
      network panel show nothing readable.

## 5. Dashboard "dForms Referral Experiment"

Every name below is the event as it arrives in PostHog (the app adds `forms_`).

Invitee funnel (ordered, by person):

1. `forms_landing_referral_link_opened` `{code}` (landing)
2. `forms_signup_completed`
3. `forms_referral_signup` `{referral_code, referral_source: link|invite}`;
   sets the person property `referred_by`

Steps 1 and 2 join through the landing's existing `ph_id` hand-off. After the
first test signup, check that step 1 to 2 converts; zero means the join is broken.

Referrer funnel (ordered, by person):

1. `forms_referral_dialog_opened` `{surface}`
2. `forms_referral_link_copied` `{surface}` or `forms_referral_link_shared`
   `{channel: whatsapp|email|x, surface}`
3. `forms_referral_toast_shown` `{count}` (a referral arrived)
4. `forms_referral_unlocked` `{referral_code, referral_count, workspaces_hidden}`;
   sets `referral_code` and `referral_unlocked: true` on the person
5. `forms_referral_celebration_shown`

`surface` is `menu`, `banner`, `banner_help` or `badge_switch`. Also chart
`forms_referral_banner_dismissed` `{count}` to see who closes the banner.

Other tiles:

- [ ] Per-referrer table: `forms_referral_signup`, total count, broken down by
      `referral_code`, sorted descending.
- [ ] Surfaces: `forms_referral_link_copied` and `forms_referral_link_shared`
      broken down by `surface` and `channel`.
- [ ] Invitee recordings: a saved recordings filter on persons where
      `referred_by` is set, plus one on sessions with
      `forms_landing_referral_link_opened`.

## 6. Kill switch

Set `REFERRAL_PROGRAM=false` on the API and restart. Then:

- the menu entry, the banner, the dialog, the toasts and the celebration are gone;
- a link claim answers `credited: false`, and invites are neither recorded nor credited;
- the name lookup answers 404, so the landing shows no greeting;
- a pending reminder email ends at delivery without being sent;
- countdown and "you did it" emails already queued still go out;
- earned unlocks stay: those workspaces keep the badge hidden;
- no data is deleted. Turning it back on resumes with the same codes and counts.

## 7. Ending the campaign

Set `REFERRAL_CAMPAIGN_ENDS_AT` before launch (or later, with a restart). From
that moment:

- the top banner and the 7-day reminder email stop;
- the link, the count, the menu entry and the dialog stay;
- referrals still count, the countdown email still goes out, and a fifth
  referral still unlocks the badge.

To stop the program completely, use the kill switch (section 6) as well.

## 8. Known gaps

- **Invitee bound before first sign-in.** `projectRoster` can bind an invited
  teammate's member row when an admin opens the members list, before that person
  first signs in. The invitee then reads as known, and the inviter gets no credit.
- **One reminder per person, for good.** `referrer.nudge_sent_at` is never reset,
  so a person nudged in this campaign is not nudged in a later one.
- **Open premium mode.** In `open` premium mode (local dev, forks) the banner
  shows even when the workspace pays. With the identity service on and
  `PREMIUM_FEATURES` unset, the badge rule runs `locked`, where a fresh paid
  verdict hides it; check that production does not set `PREMIUM_FEATURES=open`.
- **Promoted owners.** A member promoted to owner after the unlock gets the badge
  switch but no automatic hide.
- **WorkOS fallback path.** A workspace created through the WorkOS fallback
  sign-in has no future-workspace hook, so it does not start with the badge hidden.
- **Explicit "show" before 0032.** A workspace that turned the badge off and back
  on before migration 0032 has no `hide_attribution_chosen_at`, so it reads as
  "no choice" and a referral unlock of its owner hides the badge anyway. Only
  saves through the switch from 0032 on are told apart from the default.
- **Sign-in latency.** The sign-in callback now posts the attribution record and
  then the referral claim, one after the other, each with a 3 s timeout: in the
  worst case the redirect to the dashboard waits up to 6 s.
- **Local auth.** With `AUTH_PROVIDER=local` the `/?ref=` code is not carried
  through sign-in (the claim lives in the workos callback). The QA spec sends the
  claim itself; see `qa/QA-CONTEXT.md`.
