---
'@quill/web': patch
---

The workspace-reset redirect lands on the public origin again.

`/api/workspace/reset` (where the app sends the browser when the chosen workspace answers 403, to clear the stale cookie) built its redirect from `request.url`. Behind the deployment's proxy the standalone server sees no public Host, so that URL is `https://0.0.0.0:3000/...` and the browser was sent there verbatim. The redirect is now built from `requestOrigin` (PUBLIC_APP_URL first, forwarded headers as the self-host fallback), like every other absolute redirect in the app.
