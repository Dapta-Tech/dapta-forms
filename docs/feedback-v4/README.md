# July 20 2026 — bug-fix round (post manual QA)

This round turns a session of hands-on manual testing (building forms A→D) into
fixes: 6 failures, 5 blockers, and 16 improvements the tester logged. The root
blocker — nothing in the Results/scoring panel would save — was fixed first,
because it made the whole score→outcome chain untestable.

Every change is additive to the versioned `formConfig` (no schema migration),
covered by Playwright e2e, and validated end to end against a live server. The
full evidence: 415 package tests, Postgres parity 52/52, 59 e2e green (0 product
regressions), and a confirmed score→outcome→message chain.

## The root blocker — autosave

**Bug:** clicking "Add a range" in Results showed "Saving… → Not saved" and
nothing persisted, so the tester could not exercise scoring at all.

**Cause:** "Add a range" created an outcome with an empty `label`, which the
config schema rejected (`label.min(1)`) → HTTP 400 on every autosave, and the
invalid outcome stayed in state so **every** later edit also 400'd. The error
was swallowed into a bare "Not saved".

**Fix:** empty outcome labels are allowed (superset — every prior config still
parses), and autosave is now reliable across **every** tab:
- surfaces the real server error instead of a silent "Not saved";
- client-pre-validates the config before the request;
- retries a transient failure once;
- **flushes a pending save when you leave mid-debounce** — SPA nav,
  `visibilitychange`, and a `keepalive` `beforeunload` PUT — so no edit is lost;
- normalizes a scheme-less redirect (`example.com` → `https://example.com`) so
  autosave never fires a 400-ing URL.

## Scoring (was blocked)

- **Per-option points** are a wider, labeled, hinted column that accepts
  **negatives**; the slider From/To/Points editor now shows for every slider
  (no longer hidden behind the form-wide Scoring toggle, which is now labeled as
  form-wide). A nudge appears when scoring is on but the max is still 0.
- **`NumberField`** no longer leaves a leading zero (`01`→`1`), allows empty, and
  accepts negatives — fixing every number box in the editor.
- **Results numbering**: the Points card now uses each step's real position (a
  slider at question 5 reads "5", not the filtered "2").

**Verified end to end:** a scored form (MC 10/5/0 + slider ranges + 3 outcome
ranges) saves cleanly, and three real submissions route correctly — score 0 →
"Low fit", 10 → "Mid fit" (interpolating `[email]`), 20 → "High fit" — each with
its own message.

## Logic

- **Operators by field type** (additive `op`/`value`/`min`/`max` on the
  condition): choice fields keep "matches any of"; slider/number fields get
  **equal / greater / less / between**. Back-compat: a bare `{field, values}`
  still means "in".
- **Contradiction guard**: an inline warning when show-when and hide-when
  provably contradict on the same field.
- **Dynamic question**: enabling "Vary the question by a field" seeds a default
  variant so the pattern is clear (a variant only swaps the title; branch flow
  with Logic).

## Reveal + outcomes

- **Reveal position** is an additive `config.revealAfterStep`, surfaced as a
  **draggable marker in the question list** (like the partial-submit point) that
  **defaults to the end** — fixing the bug where enabling the reveal on the
  selected Q1 dropped it mid-form. `triggersReveal` is kept as a back-compat
  fallback. A Behavior "Edit reveal screen" button jumps to Design.
- **Per-outcome message**: outcomes gain an optional `message` body, editable per
  score range and rendered (interpolated) on the done screen — each range can
  show its own copy.

## Fields + prefill

- **Hidden questions** (`step.hidden`) + **real URL-parameter prefill**: open a
  form with `?fieldkey=value` and that field is prefilled/submitted; a hidden
  step isn't shown but its URL-supplied value rides into the submission. Scoped
  to declared fields only, values capped, re-validated server-side.
- **Per-form phone default country** (`step.phoneDefaultCountry`, ISO-2).
- **`@` recall in the description**, backed by real engine interpolation of the
  helper text (previously only the title interpolated).

## Editor polish

- **Template picker** preserves the name you typed (no more "Prueba QA" →
  "Lead qualifier"); "Start from scratch" leads; clearer cursor/hover.
- **Logic view** redesigned: distinct Start/question/ending nodes, labeled
  "If X → …" branch edges, a traceable "Otherwise" path, calm connectors
  (reduced-motion aware).
- Name-step field keys are hinted as URL-prefill parameters; "Personal email
  only" is hidden on the first question (impossible there).

## Verification

- **415** package tests, typecheck + lint 16/16.
- **Postgres parity 52/52** (no new migration — all fields are additive on the
  jsonb config).
- **59** Playwright e2e green (26 new `v4-*` + 33 regression); the one non-pass
  was an environmental flake that passed on isolated re-run. **0 product
  regressions.**
