---
'@quill/types': minor
'@quill/engine': minor
'@quill/shared': minor
'@quill/mcp': patch
'@quill/web': minor
---

A form can forward the visitor's UTM parameters to its redirect (#310).

**Config.** The form-level `ending` takes an optional `forwardUtm` boolean. Absent or `false` changes nothing, so every stored config keeps behaving as before.

**Engine.** `appendUtm(url, utm)` appends the `utm_*` entries of `utm` to a URL. It ignores every other key, never overwrites a `utm_*` key the owner already wrote (compared case-insensitively), keeps the existing query bytes and the `#hash`, and returns the URL unchanged when there is nothing to append or it does not parse. `forwardedUtm(config, utm)` hands the UTMs through only when `ending.forwardUtm` is on. `resolveEnding` takes a `utm` option and `redirectUrlFor` an optional `utm` argument; both append the UTMs after the `[key]` tokens are filled or stripped.

**Renderers.** With `forwardUtm` on, both layouts append the same UTMs the submission carried (the form's own, else the landing's) to every redirect: the ending's, an outcome's own `redirectUrl`, and the redirect after a booking, immediate or delayed. The UTMs are forwarded on an embedded form too, because they are campaign data, not answers. The `http(s)` check still runs on the final URL.

**Editor.** The ending panel shows a "Forward UTM parameters" switch as soon as the form or any score range has a redirect. The redirect hints, in the ending panel and the outcomes dialog, now warn that an answer such as an email placed in the URL ends up in the destination site's browser history and server logs. English and Spanish.

**Agent docs.** The API skill and the MCP guide document `ending.forwardUtm` and the same privacy warning.
