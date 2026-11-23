---
'@quill/api': minor
'@quill/notifications': minor
'@quill/db': patch
---

Referral program: emails to the referrer. Each referral that leaves a person between 1 and 4 queues the outbox email `referral_joined` ("Ana joined. 3 to go to remove the badge", with "Just 1 to go! Ana joined" at 4 of 5): the count out of 5, the badge named by its localized label, a "Share my link" button to the referral link and the WhatsApp, email and X share links. The referral that unlocks the person queues `referral_unlocked` ("You did it") instead, exactly once; later referrals send nothing. Link and teammate-invite credits both email. The address and the language come from the referrer's most recently seen member row; with no address nothing is queued. The invitee is named by their safe first name, else "Someone" / "Alguien", never an email. An email failure never undoes a credit or an unlock.
