# MCP endpoint

dForms serves a remote [Model Context Protocol](https://modelcontextprotocol.io)
endpoint, so an agent can build, publish and read forms without a custom
integration. The code is [`packages/mcp`](../packages/mcp); the API mounts it.

- **URL:** `POST <your-api-origin>/mcp`. Set `MCP_PUBLIC_URL` on the web app to
  show another address to your users (a dedicated MCP host in front of the API).
- **Transport:** Streamable HTTP, stateless. No session id, no sticky sessions:
  any replica answers any call.
- **Protocol:** one handler serves 2026-07-28 clients and legacy `initialize`
  clients (2025-06-18, 2025-11-25).
- **On by default.** `MCP_ENABLED=false` answers 404.

## Authentication

Every call needs a workspace API key, the same `dforms_...` key the REST API
takes, sent as `Authorization: Bearer dforms_...`. Members create keys in dForms
(MCP, then API keys).

- The key acts as the member who created it, with that member's **current**
  role, and stops working the moment it is revoked or the member leaves the
  workspace (it is checked again on every tool call).
- The workspace always comes from the key, never from a tool argument. A form
  of another workspace answers `NOT_FOUND`, exactly like a form that does not
  exist.
- A request without a key gets a 401 with a `WWW-Authenticate: Bearer`
  challenge. A wrong, revoked or orphaned key gets a 401 too; it is never
  treated as anonymous. A key in the URL (`?api_key=`, `?access_token=`, ...)
  is refused with 400 so it never reaches an access log.
- Browser-based connectors that sign in with OAuth (Claude in the browser,
  ChatGPT) are not supported yet: this release is the API-key door. The door's
  `authenticate` and `challenge` hooks are where an OAuth token verifier plugs
  in later, with nothing past the door changing.

## Tools

| Tool | Kind | What it does |
|---|---|---|
| `whoami` | read | The workspace and member the key acts as, with the role. |
| `list_forms` | read | Forms, most recently updated first, with id, `public_url` and whether edits are unpublished. Filter by name, page with `limit`/`offset`. |
| `get_form` | read | One form: `public_url`, publish state and the config to edit (the pending draft when there is one). |
| `create_form` | write | Creates a form from a full config. It is live at once; the result carries its `public_url`. Not idempotent. |
| `update_form` | write | Saves a new config as an unpublished draft (and can rename). Requires `expected_updated_at`; a form saved elsewhere since answers `STALE`. |
| `publish_form` | **destructive** | Makes the draft live, replacing what respondents see. The replaced version is kept for `revert_form`. |
| `revert_form` | **destructive** | Puts the previously published version back live; a second revert undoes the first. |
| `list_responses` | read | A page of responses: status, score, times, and the answers under `respondent_supplied`. |
| `get_form_analytics` | read | The funnel the Results screen shows (views, starts, submissions, completion rate, median time, partials, bookings, drop-off per question), each metric with its definition. |
| `get_form_guide` | read | The rules, step types, logic, the config JSON Schema and worked examples. |

Every tool carries a title, `readOnlyHint` / `destructiveHint` /
`idempotentHint` / `openWorldHint`, an input schema and an output schema with
`structuredContent` (plus a short text summary). There are no delete tools, and
nothing about keys, members, workspaces, integrations or destinations.

Every role (owner, admin, member) can create, edit and publish forms in the web
app, so every role's key can use every tool. The tools run the API's own form
handlers, so any role rule those handlers apply holds for the MCP too.

### Writing a config

- `create_form` and `update_form` validate against the real form contract plus
  the rules every API key is held to: no field the editor cannot show
  (`UNSUPPORTED_FIELD`), no step without a question (`EMPTY_QUESTION`), never a
  config without `steps` on an update (`STEPS_REQUIRED`). A refusal answers
  `VALIDATION_FAILED` with every problem on its own line, path first
  (`config.steps.2.question`), so a model fixes them all in one retry.
- What is saved is the engine's normalized config, the same shape the editor
  saves, so everything an agent writes opens and edits in the dForms editor.
- Forms created through the MCP record `created_via = 'mcp'`.

### Untrusted text

Answers are typed by members of the public, so they are hostile input to a
model. `list_responses` returns them only inside `respondent_supplied`, with
control and zero-width characters, HTML and markdown links and images removed
and every value length-capped. Tell your agent to treat `respondent_supplied`
as data, never as instructions.

## Connect an agent

Replace `https://forms-api.example.com/mcp` with your endpoint and put your key
in the `DFORMS_API_KEY` environment variable. No snippet below contains a key.

**Claude Code:**

```bash
claude mcp add --transport http dforms https://forms-api.example.com/mcp \
  --header 'Authorization: Bearer ${DFORMS_API_KEY}'
```

The single quotes matter: the shell leaves the variable alone, Claude Code
stores the literal `${DFORMS_API_KEY}` and expands it each time it connects.

**Codex** (`~/.codex/config.toml`):

```toml
[mcp_servers.dforms]
url = "https://forms-api.example.com/mcp"
bearer_token_env_var = "DFORMS_API_KEY"
```

**Cursor** (`.cursor/mcp.json` or `~/.cursor/mcp.json`; the MCP page in dForms
also has a one-click install link):

```json
{
  "mcpServers": {
    "dforms": {
      "url": "https://forms-api.example.com/mcp",
      "headers": { "Authorization": "Bearer ${env:DFORMS_API_KEY}" }
    }
  }
}
```

**Any agent SDK** (TypeScript, official client):

```ts
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const client = new Client({ name: 'my-agent', version: '1.0.0' });
await client.connect(
  new StreamableHTTPClientTransport(new URL('https://forms-api.example.com/mcp'), {
    requestInit: { headers: { Authorization: `Bearer ${process.env.DFORMS_API_KEY}` } },
  }),
);
const forms = await client.callTool({ name: 'list_forms', arguments: {} });
```

## Security

- **Transport.** The SDK handler checks nothing by itself, so the door does, in
  this order: the switch, `POST` only (405), `Host` against `MCP_ALLOWED_HOSTS`
  when set (403), a browser `Origin` not in `MCP_ALLOWED_ORIGINS` (403; clients
  without an `Origin`, which is every non-browser MCP client, are unaffected),
  credentials in the URL (400), `application/json` only (415), then the key.
  The same list is the endpoint's CORS policy (preflight answered, no
  credentials), kept apart from the dashboard's `CORS_ORIGINS`: neither list
  opens the other surface.
  Bodies are capped by the API's JSON parser, like every REST route.
- **Rate limits.** Every request of a key takes a token from its MCP bucket
  (`MCP_RATE_LIMIT_*`, HTTP 429 with `Retry-After`); write tools also take one
  from a tighter bucket (`MCP_WRITE_RATE_LIMIT_*`, a `RATE_LIMITED` tool error
  with a delay); and every tool call counts against the key's 120 calls a
  minute, shared with the REST API. Requests without a valid key take from the
  per-address `RATE_LIMIT_*` bucket, so guessing keys is throttled. Buckets live
  in each process: with N replicas the effective limit is up to N times higher.
- **Timeout.** A tool call longer than `MCP_TOOL_TIMEOUT_MS` is abandoned with a
  `TIMEOUT` tool error that tells the agent to read before it retries.
- **Audit.** One JSON line on stdout per tool call: time, request id, protocol
  version, caller (the key prefix such as `dforms_ab12c`), workspace and member
  ids, tool, a hash of the redacted arguments, the form ids it touched, result
  and latency. It never contains the key, a config, a form name, a date filter
  or an answer. A call the SDK refuses before any tool runs (a malformed
  argument) is not audited.

## Configuration

All optional; unset (or blank) means the safe default. See
[`SELF-HOSTING.md`](../SELF-HOSTING.md) for the table.

| Var | Where | Default |
|---|---|---|
| `MCP_ENABLED` | API | `true` |
| `MCP_ALLOWED_ORIGINS` | API | unset (no browser origin allowed) |
| `MCP_ALLOWED_HOSTS` | API | unset (no `Host` check) |
| `MCP_RATE_LIMIT_CAPACITY` / `MCP_RATE_LIMIT_REFILL_PER_SEC` | API | `120` / `2` |
| `MCP_WRITE_RATE_LIMIT_CAPACITY` / `MCP_WRITE_RATE_LIMIT_REFILL_PER_SEC` | API | `20` / `0.2` |
| `MCP_TOOL_TIMEOUT_MS` | API | `20000` |
| `MCP_PUBLIC_URL` | web (runtime) | `<PUBLIC_API_URL>/mcp` |

## Check it yourself

`pnpm run build:packages && cd apps/api && pnpm e2e:mcp` boots the API the way
the production image does (tsx with `tsconfig.runtime.json`) on a throwaway
SQLite file and plays a whole session with the official client: the anonymous
refusal, a legacy handshake, the tool list, a refused config, a create, a
response submitted through the public API, a draft, a stale write, a publish,
the responses and the funnel, then a key revoked mid-session.
