---
'@quill/config': patch
---

The `IAM_DB_*` settings (`IAM_DB_HOST`, `IAM_DB_PORT`, `IAM_DB_NAME`, `IAM_DB_SCHEMA`, `IAM_DB_USER`, `IAM_DB_PASS`, `IAM_DB_SSL_CA`) are back in the server environment schema, all optional: the API reads them for the MCP person directory, which is off (never a refused boot) when they are incomplete.
