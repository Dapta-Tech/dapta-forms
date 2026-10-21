# @quill/mcp

The dForms MCP server, framework-free: task-shaped tools for building,
publishing and reading forms, a hardened Streamable HTTP door in front of the
official TypeScript SDK (`@modelcontextprotocol/server`), and the guide that
teaches a model to write a dForms config. forms-api mounts it at `POST /mcp`
(`apps/api/src/mcp.controller.ts`); what it offers to an agent, and how to
connect one, is in [`docs/MCP.md`](../../docs/MCP.md).

## Shape

| Module | What it is |
|---|---|
| `backend.ts` | `FormsBackend`, the port the host implements. The tools never touch a database or an HTTP route; forms-api implements the port over its own form handlers (`apps/api/src/mcp.backend.ts`), so every rule a write is held to on the web applies to an agent too. |
| `tools.ts` | The catalog: ten tools, each with a title, the four behaviour hints, a zod input and output schema, and a `run` over the backend. No delete tools, no workspace argument. |
| `server.ts` | `FormsMcpServer`: the SDK's stateless handler (2026-07-28 and 2025-era clients), a fresh `McpServer` per request, and the one wrapper every tool call runs through: write rate limit, timeout, error mapping, one audit line. |
| `door.ts` | `McpDoor`: the HTTP guard. Switch, `POST` only, `Host`, `Origin`, credentials in the URL, JSON content type, then the bearer token, with rate limits per credential and per client address. No anonymous door. |
| `support.ts` | `ToolFailure` (stable code plus what to do), validation issues rendered path first, the untrusted-text cleaner, argument redaction for the audit line. |
| `guide/` | `@quill/mcp/guide`: the config JSON Schema (generated from `formConfigSchema`, minus the fields the editor cannot show), the rules, step types, logic and examples. Shared with the web app's API skill zip, so the two never teach different rules. No SDK import. |

## Hosting it

```ts
import { FormsMcpServer, McpDoor } from '@quill/mcp';

const server = new FormsMcpServer({ backend, toolTimeoutMs: 20_000, writeLimiter });
const door = new McpDoor({
  server,
  enabled: true,
  allowedOrigins: [],
  allowedHosts: [],
  authenticate: async (token) => lookUpCaller(token), // McpCaller | null
  keyLimiter,
  ipLimiter,
});

// In a Node handler, with the JSON body already parsed onto req.body:
await door.handle(req, res, { ip: clientAddress(req), requestId });
```

`authenticate` resolves a bearer token to an `McpCaller` (workspace, member,
role, credential id, a public label, and an opaque `context` the backend uses
to act as that caller). Phase 1 resolves the host's API keys; an OAuth token
verifier plugs in at the same hook later, with `challenge` adding the
protected-resource metadata to the 401.

## Tests

`pnpm --filter @quill/mcp test` runs the package on a real HTTP socket with an
in-memory backend, driven by the official MCP client: the door's guards, both
protocol eras, rate limits, the timeout, every tool, validation rendering, the
untrusted-text cleaner and audit redaction. forms-api has its own end-to-end
specs over the real handlers (`apps/api/src/mcp.integration.spec.ts`) and a
production-runtime check (`pnpm e2e:mcp` in `apps/api`).
