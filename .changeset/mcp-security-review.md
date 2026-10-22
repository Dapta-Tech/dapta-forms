---
'@quill/mcp': patch
---

Security fixes for the MCP server.

- The door refuses a JSON-RPC batch (a body that is an array) with 400, so one request can no longer run many tool calls on a single rate-limit token.
- Credentials in the URL are refused whatever their letter case (`?API_KEY=`, `?Token=`), and `bearer` and `access_key` are on the list too.
- Text typed by respondents is cleaned until nothing changes, so a nested image or link such as `[![x](a)](https://example.test/p.png)` no longer leaves an image behind. Cleaning a cleaned text changes nothing.
- Every tool result carries its data as JSON text after the summary, for clients that read only the text content, besides `structuredContent`.
- `onInternalError` and `onTransportError` receive the error class and code only (`describeError`), never the message or stack, which can quote data from the request.
