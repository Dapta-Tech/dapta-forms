---
'@quill/engine': minor
'@quill/types': minor
'@quill/shared': minor
'@quill/mcp': minor
---

A `checkbox` question type: one native box with text beside it, for a consent line such as "I accept the privacy policy".

- `FORM_FIELD_TYPES` gains `'checkbox'` (last), so `formFieldType`, the API v1 schema and the MCP schema accept it. No new step fields: `question` is the text beside the box, `required` blocks submit until it is checked, `helper` is an optional line under it.
- Links in the text as `[text](https://url)`. Only http(s) links render as links (new tab); any other scheme stays literal text. Engine: `parseInlineLinks`, `inlineLinksPlainText`, `isCheckboxChecked`, `isHiddenStep`.
- Checked stores `true`; unchecked stores nothing (never `false`). `canonicalizeAnswer` turns `'true'` into `true`. A checkbox question is shown as written: no `[key]` tokens and no question variants.
- Validation: `validateAnswerCode` returns the new code `'consent'` for a required box left unchecked and `'option'` for any other value; `validateAnswer` says "Check the box to continue.". i18n: `renderer.errors.consent` (EN + ES).
- `hidden`, `defaultValue` and URL prefill have no effect on a checkbox: it always shows and always starts unchecked.
- Answers: a check in the table, the CSV, the response panel, the owner email and the MCP; the column header shows the links as their text (`stepLabel`, `summarizeAnswersByStep`). `stepLabel` accepts an optional `type`.
- MCP `get_form_guide`: the `checkbox` step type and a note that its question takes no placeholders.
