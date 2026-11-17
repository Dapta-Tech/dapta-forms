---
'@quill/types': minor
'@quill/engine': minor
'@quill/shared': minor
'@quill/mcp': minor
---

One-page forms built for an embed can drop their chrome: the header, the answered counter, and a count that started above zero.

- `branding.showHeader` (new, optional). Only the `vertical` layout reads it. `false` removes the header above the questions (the form logo, or the form name when there is no logo), and the logo on the reveal and submitting screens. Absent or `true` keeps today's header. `slides` ignores it. `resolveDesign` resolves it to `true` when absent; no new `data-pf-*` attribute, so existing markup is unchanged. It is not part of the brand kit.
- `progressStyle: "none"` on a one-page form now hides the whole progress strip, the "X of N answered" label included, not only the bar. Any other value keeps the bar and the label. A one-page form that already stores `"none"` loses its counter.
- The answered counter no longer counts a value the page put there: a question's `defaultValue` and a URL prefill only count once the person touches the question. A terminal question with a default or a prefill no longer cuts the page on load.
- Design tab: a "Show header" switch on one-page forms, and the progress toggle offered there with two options (Bar, Hidden). i18n: `admin.editor.design.showHeader` and `showHeaderHint` (EN + ES).
- MCP `get_form_guide`: descriptions for `branding.showHeader` and `branding.progressStyle` in `config_schema`, and a rule for embedded one-page forms.
