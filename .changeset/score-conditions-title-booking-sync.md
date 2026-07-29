---
'@quill/engine': minor
'@quill/types': minor
'@quill/shared': minor
'@quill/db': patch
'@quill/destinations': patch
---

Score-sourced visibility conditions: a show/hide rule can reference the reserved
`@score` source (the running score over the steps before the one being decided),
offered in the builder as "Score so far" with numeric operators. Adds the public
form title (`config.title`, additive) resolved everywhere through the new
`publicTitle()` helper, surfaces it in the profile listing, and corrects the
destination port's idempotency-key documentation.
