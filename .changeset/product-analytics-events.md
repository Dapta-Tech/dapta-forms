---
'@quill/db': minor
---

The five product-analytics events, emitted at their real call sites: `forms_signup_completed` (from a new SignupObserver port — accounts are materialized just-in-time inside the auth provider, so there is no signup endpoint to instrument), `forms_form_created` (create and duplicate), `forms_form_published` (carrying `is_first_publish`, emitted only when `publishForm`'s own UPDATE reports it fired), `forms_form_first_view` and `forms_activation`.

The two milestone events are guarded by an ATOMIC CLAIM on the account row, not a read-then-act query: the obvious "does an earlier one exist?" check double-fires on a re-submitted session and, worse, permanently misses when two answers land at the same instant — both reproduced against the real service and now covered by regression tests.

What a bare fork does: `account.activated_at` and `account.first_viewed_at` are claimed UNCONDITIONALLY, because they are facts about a workspace rather than telemetry. Recording them lazily would mean every account that crossed a milestone while analytics was off announced it the day a key was finally set — the same false-conversion wave migration 0010's backfill prevents, just triggered by env timing. The cost is one primary-key UPDATE that matches nothing (no row lock, no WAL) after the first answer. Everything else IS gated: no event is captured, no outbox row is written, `member.last_seen_at` is not touched, and no browser script is loaded without a key. The claims never throw into a user path — a lost claim is retried by the next answer; a failed submission is not recoverable.

Also writes `form.created_by` from the resolved principal, never request input.
