---
'@quill/api': patch
---

While the identity provider is unreachable, the MCP OAuth check no longer fetches its signing keys, or its authorization server metadata, on every request. It retries at most once every few seconds for the keys and every 30 seconds for the metadata, so requests answer at once instead of each waiting for a timeout.
