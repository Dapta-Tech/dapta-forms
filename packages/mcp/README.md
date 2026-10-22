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
| `tools.ts` | The task-shaped core: twelve tools to build, publish and read forms, each with a title, the four behaviour hints, a zod input and output schema, and a `run` over the backend. Every tool that acts in a workspace takes an optional `workspace_id`. |
| `config-check.ts` | What the MCP refuses on top of the API's agent rules, so nothing an agent sends is changed silently: unknown fields, repeated step keys, option values and outcome ids, references to steps that do not exist, `@score` with op `in`, a min above its max. A problem the form already had in the config the agent read is reported as a warning instead. The REST API keeps its v1 behaviour. |
| `parity-backend.ts`, `parity/` | One tool for every other route of the public API reference (`API_REFERENCE` in `@quill/shared`): folders, the link, copies, deletes, destinations, single responses, files, the CSV, deliveries, the answer summary, the brand kit, notification emails, integrations (read only), the profile and the link code. `API_ROUTE_TOOLS` maps each route to its tool; forms-api's parity spec fails when a documented route has none. Deletes and resets carry `destructiveHint` and tell the agent to confirm first. |
| `catalog.ts` | `CATALOG`: the core, then the parity tools. What the server registers. |
| `workspace.ts` | Which workspace a call acts in: an API key keeps its own (another `workspace_id` is refused), an MCP connection acts in the one the call names, or its only one; staff always name one, and may name any live workspace. Also the door's rate-limit bucket per member. |
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

`authenticate` resolves an API key to an `McpCaller` (workspace and its name,
member, role, credential id, a public label, and an opaque `context` the
backend uses to act as that caller). With an `oauth` side, any other bearer is
an access token: its `authenticate` resolves it to an `McpConnection`, a person
with one `McpCaller` per workspace they may act in, and each tool call names
the one it acts in (`workspace_id`, optional with a single workspace). When the
host judges the person staff of the deployment on that request, the connection
also carries `staff` (`McpStaffAccess`): `search` over every workspace and
`enter` into any live one through a staff access grant. Staff always name the
workspace, and the tools tell the agent to confirm it with the user first.

## Tests

`pnpm --filter @quill/mcp test` runs the package on a real HTTP socket with an
in-memory backend, driven by the official MCP client: the door's guards, both
protocol eras, rate limits, the timeout, every tool, validation rendering, the
untrusted-text cleaner and audit redaction. forms-api has its own end-to-end
specs over the real handlers (`apps/api/src/mcp.integration.spec.ts`,
`apps/api/src/mcp-parity.integration.spec.ts`) and a
production-runtime check (`pnpm e2e:mcp` in `apps/api`).
