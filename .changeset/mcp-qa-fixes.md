---
'@quill/mcp': minor
'@quill/db': minor
'@quill/shared': minor
'@quill/engine': minor
---

The MCP no longer answers OK when it did something other than what an agent
asked.

- `discard_draft` (new tool) throws away an unpublished draft so the form goes
  back to its live version. `revert_form` now says it only rolls back a
  publish and must never be used to undo unpublished edits.
- `list_responses` and `get_form_analytics` refuse a `from` or `to` they
  cannot read (an impossible day, a word, epoch seconds), a `from` after `to`
  and an unknown `time_zone`, instead of reading everything.
- `get_form`, `list_forms` and every form result carry `is_live` and
  `live_step_count`; a form never published with a step is named in the
  summary so its empty link is not shared.
- `create_form` and `update_form` refuse, path by path, what the API would
  otherwise change without a word: unknown fields, repeated step keys, option
  values and outcome ids, a `goto` or condition naming a step that does not
  exist, `@score` with op `in`, a min above its max. `update_form` refuses to
  drop the form's `branding` (`BRANDING_MISSING`, `null` removes it on
  purpose) and warns when it ignores `destinations`; `create_form` says when it
  filled `branding` in. A problem of these kinds the form already had in the
  config the agent read is saved as it was, with a warning; one the API
  refuses anyway says it came with the form. The REST API keeps its v1
  behaviour.
- A `publish_form` with no draft pending answers `nothing_published`, and a
  retry after it went through answers that instead of `STALE`.
- `list_responses` gives each answer its `step_key` and `type`, each completed
  response its `outcome`, and keeps answers to removed steps (`step_removed`).
- `get_form_analytics` warns when the funnel does not add up (responses
  created through the API), flags `daily_truncated`, and names the first
  drop-off row "(form opened)".
- `list_forms` matches names without regard to accents, `get_form` leaves
  `destinations` out of the config, and the guide's config schema speaks of
  `create_form` and `update_form` (`formConfigJsonSchema('mcp')`).
- `@quill/mcp`: `FormsBackend.discardDraft`, and the optional
  `FormListItem.liveStepCount`, `ResponseItem.outcome` and
  `ResponseAnswer.stepKey`, `type` and `stepRemoved`.
- `@quill/db`: `discardDraft` and `listLiveStepCounts`.
- `@quill/engine`: `summarizeAnswersByStep`, the summary rows with each
  step's key and type; `summarizeAnswers` is built on it and unchanged.
- `@quill/shared`: `POST /v1/forms/:id/discard-draft` in the API reference,
  with its description in English and Spanish. An API key may call it.
