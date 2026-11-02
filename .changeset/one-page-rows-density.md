---
'@quill/engine': minor
'@quill/types': minor
'@quill/shared': minor
'@quill/mcp': minor
---

One-page forms can look like a regular web form: two short fields side by side, a label above each name input, and compact spacing.

- `steps[].width` (new, optional: `'full' | 'half'`). Only the `vertical` layout reads it. Two consecutive `half` steps share a row from 640 px wide and stack below that; three in a row make a pair plus a full row, never three columns. Only `text`, `email`, `phone`, `url` and `dropdown` can be half; any other type, a hidden step, or a half step with no half neighbour renders full width. Pairing runs on the live walk, after logic. Engine: `FORM_STEP_WIDTHS`, `HALF_WIDTH_TYPES`, `canHalfWidth`, `onePageRows`.
- `steps[].fieldLabels` (new, optional, keyed like `placeholders`). On a `name` step in the `vertical` layout, a visible label above each input; the question title stays for screen readers and the response column. A sub-field with no label shows the localized default. Engine: `nameFieldLabels`. Ignored on slides and on any other step type.
- `branding.density` (new, optional: `'comfortable' | 'compact'`). `compact` drops the lines between questions and spaces fields 16 px apart. `resolveDesign` resolves it to `comfortable` when absent; `designAttributes` is unchanged (the vertical renderer adds `data-pf-density="compact"` itself), so existing markup is byte-identical. Not part of the brand kit. Slides ignores it.
- Editor: a Width toggle (Full, Half) on short questions of one-page forms, a Label field per name sub-field, and a Density toggle in Design. i18n: `admin.editor.design.density`, `densityHint`, `densityComfortable`, `densityCompact`, `admin.editor.nameStep.label`, `labelHint` (EN + ES).
- MCP `get_form_guide`: descriptions for `steps.[].width`, `steps.[].fieldLabels` and `branding.density` in `config_schema`, and a rule on making a one-page form look like a regular web form.
