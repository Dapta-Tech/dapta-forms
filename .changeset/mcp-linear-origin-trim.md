---
'@quill/mcp': patch
'@quill/shared': patch
---

The MCP door trims the trailing slashes of an `Origin` (the request header and the `MCP_ALLOWED_ORIGINS` entries) with a linear loop instead of a backtracking regex, so a long run of slashes in a request can no longer stall it. The comparison is unchanged: trimmed, lower case, no trailing slash. `@quill/shared` now exports `trimTrailing` and `trimChar`, and the web app's public API and MCP addresses use `trimTrailing` too. The MCP test harness answers its 500s as plain text, and the MCP page spec reads the rendered text through an HTML parser instead of stripping tags with a regex.
