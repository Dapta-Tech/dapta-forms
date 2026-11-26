---
'@quill/db': patch
'@quill/shared': patch
---

Referral program: the top banner. `GET /v1/me` carries `referral.bannerVisible`: true while the campaign runs, the person is below the goal and holds no referral unlock, the workspace has no fresh paid Dapta AI verdict, and the person has not closed the banner in the last 7 days. `POST /v1/me/referral/banner/dismiss` closes it for the person, in every workspace, for 7 days (session only; API keys are refused). The dashboard draws a 48 px strip at the top of the main area (not in the form builder): the badge itself, crossed out by a fire line as the count grows, a "?" popover that shows where the badge appears, a flowing bar to a race flag, and Copy link, Share and close. CSS-only motion, off under reduced motion; container-query layout down to 320 px. New web event `referral_banner_dismissed`; `referral_link_copied` and `referral_link_shared` now carry `surface` (`menu` or `banner`). The Spanish share dialog names the badge «Hecho con dForms».
