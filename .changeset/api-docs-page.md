---
'@quill/shared': minor
---

The API reference behind the new API docs page under Developers.

- `API_REFERENCE`: every route an API key may call (44), with its area, parameters, an example request and an example answer, plus `apiEndpoints()`, `apiCurl()`, `apiAnchor()` and `apiDisplayPath()` to render it. Also the error codes, the limits (120 requests a minute per key, 10 active keys per person per workspace) and what a key cannot do.
- `admin.apiDocs` in English and Spanish, keyed by the same route strings, so a route or a parameter without its text does not compile.
- The API checks the reference in its own tests: the documented routes must equal the key allowlist in both directions, every example body goes through the real handler with a key and passes the strict validation, every example answer only names fields the handler returns, and the example 400 is the one the API really sends.
