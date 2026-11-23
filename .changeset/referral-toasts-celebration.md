---
'@quill/web': patch
'@quill/shared': patch
---

Referral program: live moments in the dashboard. A toast when the person's referral count went up since the last count they saw in this browser ("Someone joined with your link. 3 to go"), and a one-time celebration when they reach the goal: the badge pill burns away under the fire line, with sparks and the race flag, a link to the badge setting and Close (still under reduced motion). The last state seen is kept per person in localStorage; the first sight only remembers it, so nothing shows for referrals or an unlock that came before. The count is read again on window focus and when the tab comes back, never on a timer. Events `referral_toast_shown {count}` and `referral_celebration_shown`. Mounted in the admin shell on every page, the form builder included; nothing renders while the program is off.
