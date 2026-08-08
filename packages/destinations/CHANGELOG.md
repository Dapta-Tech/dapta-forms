# @quill/destinations

## 0.1.0

### Minor Changes

- a6b7fcf: Pilot-port feature set: per-outcome booking embeds (HubSpot Meetings / Calendly) with a booking callback and durable booking→CRM sync via the outbox; answer-forced outcome overrides; reveal screen duration/subtitle templates/prewarm; per-form tracking config (GTM, Meta Pixel, PostHog, HubSpot); HubSpot destination value maps, outcome property, static properties, company inference and bookingSync; draft→publish workflow (form.draft_config/published_at, additive migration 0003 + booking_event table); respondent confirmation email wiring; normalizeConfig now preserves additive top-level config fields; i18n EN+ES for all new surfaces.
- 310f098: Say why a webhook test delivery failed.

  The toast read `Test failed: webhook delivery failed: HTTP 400` — true, and
  useless. A status code alone sends the author to check the wrong thing.

  `WebhookHttpError` now carries the status and a truncated copy of the endpoint's
  own response body, which names the real reason far more often than the code does.
  Its `message` is byte-identical to what the adapter always threw, because the
  outbox stores that string and two tests assert on it — it is a contract, not
  prose.

  The classification is deliberately conservative. Only 405/501 lets us state that
  POST is refused, because that is the one status which actually says so. A 400
  means the endpoint read the request and rejected the body; claiming the method
  was wrong there would be right often enough to be trusted and wrong often enough
  to waste an afternoon. So 4xx copy states what we send — POST, `application/json`
  — and lets the endpoint's own message do the rest.

### Patch Changes

- 9779aac: Score-sourced visibility conditions: a show/hide rule can reference the reserved
  `@score` source (the running score over the steps before the one being decided),
  offered in the builder as "Score so far" with numeric operators. Adds the public
  form title (`config.title`, additive) resolved everywhere through the new
  `publicTitle()` helper, surfaces it in the profile listing, and corrects the
  destination port's idempotency-key documentation.
- Updated dependencies [310f098]
- Updated dependencies [310f098]
- Updated dependencies [e877d55]
- Updated dependencies [b8322ea]
- Updated dependencies [310f098]
- Updated dependencies [daaabf2]
- Updated dependencies [de8df64]
- Updated dependencies [310f098]
- Updated dependencies [c6007cb]
- Updated dependencies [310f098]
- Updated dependencies [a6b7fcf]
- Updated dependencies [72a7876]
- Updated dependencies [310f098]
- Updated dependencies [9779aac]
- Updated dependencies [310f098]
- Updated dependencies [310f098]
  - @quill/types@0.1.0
