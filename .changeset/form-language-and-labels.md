---
'@quill/types': minor
'@quill/engine': patch
'@quill/shared': minor
---

A form can name its language and its button copy.

Until now the public form's chrome (Start, Back, Next, Submit, the progress
counter, the thank-you copy, the confirmation email) followed each visitor's
browser, with no way for the author to decide. Two additive config fields fix
that; a form saved before they existed renders exactly as it did.

- `config.language` (`en` | `es`, absent = Auto). Precedence on the public
  page: `?lang=` on the URL, then the form's language, then the browser,
  then English. The page description, the social card, the `lang` attribute
  on the form's subtree and the respondent's confirmation email follow the
  same resolution (the submission now carries the locale the respondent saw).
- `config.labels` (`back`, `next`, `submit`, up to 80 characters each) at the
  form level. A step's own `buttonText` still wins for that step; the cover
  keeps `cover.ctaText`. `resolveFormLabels(config, locale)` in `@quill/shared`
  is the single resolver both renderers and the builder preview use.
- Design tab: a Language selector (Auto / English / Spanish) and Button text
  fields (Submit only on the one-page layout) at the top of the panel, with
  the stock copy of the chosen language as placeholders. The live preview and
  the Preview modal render in the FORM's language, not the editor's.
- New forms are stamped with their author's language (dashboard "New form"
  and the onboarding wizard alike). Existing forms stay on Auto.
- The public error boundary and the 404 speak the visitor's language.
- i18n: `admin.editor.design.language*` / `labels*` / `label*`, and
  `renderer.error*` / `notFound*` (EN + ES).
