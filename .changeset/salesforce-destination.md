---
"@quill/types": minor
"@quill/db": minor
"@quill/destinations": minor
"@quill/shared": minor
---

Salesforce as a submission destination. A workspace connects its org once with
Client Credentials (My Domain, consumer key, consumer secret, stored encrypted
as one value), and each form maps questions, UTMs, score, submission date and
fixed values to Lead fields. A delivery finds the respondent by email first
(a Contact, then an unconverted Lead) and updates it, and creates a Lead only
when neither exists, so a person who answers twice is not duplicated (two
submissions from one email at the same instant can still race; an org's own
duplicate rules close that). Transient refusals (the API limit, lock
contention, a query timeout) are retried. Complete submissions only.
