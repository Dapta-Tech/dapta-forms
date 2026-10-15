---
'@quill/engine': minor
'@quill/notifications': minor
'@quill/shared': minor
---

`[name]` is the respondent's full name, and redirect URLs take placeholders.

- `@quill/engine`: `interpolate` reads `[name]` as `firstname` and `lastname` joined by one space (no stray space when one is missing). An answer stored under `name` itself still wins, so a form whose own step is keyed `name` reads exactly as before. New `fullNameToken`, `tokenText`, `respondentFullName` and `interpolateUrl`, which fills `[key]` tokens in a redirect URL with each value percent-encoded. `resolveEnding` takes the answers as an optional third argument and then returns the redirect URL filled in. New `stripUrlTokens` and `redirectUrlFor`: with `{ embedded: true }` (a fourth argument to `resolveEnding`) every query parameter that carries a token is dropped whole, so an embedded form's redirect never holds an answer.
- `@quill/notifications`: a `{{respondentName}}` token for both submission emails (subject, text and HTML body), the full name by the same rule. Absent when the form asked for no name, so a line that only carries it is dropped like any other empty token.
- `@quill/shared`: the token's label in English and Spanish, the redirect URL hints mention placeholders and that an embedded form does not send them, and the API reference lists `respondentName` among the notification tokens.
