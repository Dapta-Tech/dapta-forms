---
'@quill/config': minor
---

Settings for MCP connections signed in through OAuth. All optional; with `MCP_OAUTH_PROVIDER` unset or blank, the default, none of the others is read and the MCP server takes API keys only.

- `MCP_OAUTH_PROVIDER` (unset, or `workos`), `WORKOS_AUTHKIT_DOMAIN` (the issuer, an https origin) and `MCP_PUBLIC_URL` (the `/mcp` endpoint customers reach, every token's audience). `mcpOAuth` returns the resolved settings, or null when off. With a provider set, a missing or malformed value refuses to boot.
- `IAM_DB_HOST`, `IAM_DB_PORT` (5432 when unset), `IAM_DB_NAME`, `IAM_DB_SCHEMA`, `IAM_DB_USER` and `IAM_DB_PASS`: read-only access to the identity database, where the API maps a signed-in person to the user id members carry.
- `IAM_DB_SSL_CA`: the CA of that database's certificate, as the PEM itself or the path of a file holding it. Set, the certificate and its host name are verified (verify-full). Unset, the connection is encrypted but the certificate is not verified.
