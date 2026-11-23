---
'@quill/api': minor
'@quill/notifications': minor
'@quill/db': minor
---

Referral program: the 7-day nudge. Each credit that leaves a referrer between 1 and 4, while the campaign runs, drops their pending `referral_nudge` and queues a new one due 7 days later (the outbox's `nextAttemptAt`), so it only comes due after 7 days without a new referral; reaching 5 cancels it. When it comes due it is sent only while it still applies: the program is on, the campaign is running, no newer referral arrived, the person holds no referral unlock, the count is still 1 to 4, and no nudge was sent before. That last check is one guarded UPDATE of `referrer.nudge_sent_at` (`claimReferralNudge`) taken before the send, so a retry or a second replica never sends it twice; a send that fails gives the stamp back (`releaseReferralNudge`) for the outbox retry. A nudge that no longer applies finishes its row quietly. Copy (`renderReferralNudge`, ES/EN): "{left} to go. Your badge is still there" / "Te faltan {left}. Tu sello sigue ahí", naming the badge by its localized label, with the "Share my link" button and the WhatsApp, email and X share links of the countdown email. One nudge per person per campaign; no address, no nudge; a failure never breaks a credit.
