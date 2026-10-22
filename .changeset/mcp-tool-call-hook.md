---
'@quill/mcp': minor
---

Add an `onToolCall` hook so a host can report MCP usage.

`FormsMcpServer` takes an optional `onToolCall(event)`, called once per finished
tool call, right after its audit line. The event carries the tool name, whether
it failed and with which code, the duration, the protocol version, the client
(`clientInfo` name and version, user agent, vendor), how the caller signed in,
the workspace, member and person ids, and whether the call was staff's. It never
carries the arguments (not even their hash), the result, an error message, or a
workspace or form name. A hook that throws is ignored and never changes the
result.

The door now reads the client a request came from, from `initialize`'s
`clientInfo` or the per-request `_meta` envelope, and exposes it as
`McpCall.client` and `clientInfoOf`. The package itself still sends nothing
anywhere.
