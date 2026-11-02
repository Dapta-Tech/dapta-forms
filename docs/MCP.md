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

Every call needs a credential: the person's sign-in (OAuth, see
[Signing in](#signing-in-mcp-connections-over-oauth)), which is how the
dashboard tells people to connect, or a workspace API key, the same
`dforms_...` key the REST API takes, sent as `Authorization: Bearer dforms_...`.
The dashboard has no API key screens any more: its "Connect your agent" page
(`/admin/developers/connect`) walks Claude, ChatGPT, Claude Code, Codex,
Cursor and OpenClaw through the sign-in, and its Tools page
(`/admin/developers/tools`) lists what an agent can do, in plain words. Keys
are created, listed and revoked through `/v1/api-keys` only, and existing keys
keep working.

- The key acts as the member who created it, with that member's **current**
  role, and stops working the moment it is revoked or the member leaves the
  workspace (it is checked again on every tool call).
- The workspace always comes from the key. A tool's `workspace_id` may be left
  out or name the key's own workspace; any other is refused with
  `WORKSPACE_MISMATCH`, so a key never leaves its workspace. A form of another
  workspace answers `NOT_FOUND`, exactly like a form that does not exist.
- A request without a key gets a 401 with a `WWW-Authenticate: Bearer`
  challenge. A wrong, revoked or orphaned key gets a 401 too; it is never
  treated as anonymous. A key in the URL (`?api_key=`, `?access_token=`,
  `?bearer=`, ..., in any letter case) is refused with 400 so it never reaches
  an access log.
- Chat connectors that sign in with OAuth (Claude.ai, ChatGPT) use the same URL
  when the deployment turns OAuth on: see
  [Signing in](#signing-in-mcp-connections-over-oauth).

## Choosing a workspace

Every tool that acts in a workspace takes an optional `workspace_id`, and every
result names the workspace it acted in: `workspace: { id, name, access }` in the
structured content (`access` is `member`, or `staff` through a staff access
grant; an API key always says `member`), and `In workspace "<name>":` at the
start of the text summary.

- **API key:** one workspace, the key's. Leave `workspace_id` out.
- **Signed in as a person:** the person may be a member of several workspaces.
  `list_my_workspaces` lists them (name, role, id). With exactly one, every
  call uses it without `workspace_id`. With several, a call without
  `workspace_id` answers `WORKSPACE_REQUIRED` and tells the agent to call
  `list_my_workspaces`, ask the user which workspace by name, and repeat the
  call with that id. The agent sends it on every call of the conversation.
- The workspaces are the person's **active** members in dForms (any role)
  whose web login was verified recently (see
  [Who it acts as](#signing-in-mcp-connections-over-oauth)), read again on
  every request: remove or disable the member and the workspace drops out of
  `list_my_workspaces` on the next call, while the others stay. Pending
  invitations are never listed; staff access grants only as described in
  [Staff](#staff).
- A `workspace_id` the person cannot act in (never joined, removed, or one
  that does not exist) answers `NOT_FOUND` with the same message in every
  case, so nothing about that workspace leaks. A person with no workspace at
  all gets `NO_WORKSPACE` instead, also the same whatever the id names.
- One visit to dForms on the web links every workspace of the person that the
  identity service confirms on that visit; with local workspaces only (no
  identity service), each workspace links when the person opens it. A sign-in
  that reaches no workspace still connects, and acts nowhere: every tool that
  reads a workspace answers `NO_WORKSPACE` (whatever `workspace_id` it names),
  and `whoami` and `list_my_workspaces` say to open dForms once with that
  account. The first call after that visit already acts in the person's
  workspaces, with no new login and no reconnect.
- The role is the member's role in the workspace the call names, read live on
  every call.

### Staff

Staff of the deployment reach any customer workspace over a sign-in when
their access token carries a verified email on one of `IAM_STAFF_DOMAINS`
([ADR 0004](adr/0004-staff-over-mcp-by-the-tokens-verified-email.md)). The
email comes from AuthKit's JWT template, which the deployment configures with:

```json
{ "email": {{ user.email }}, "email_verified": {{ user.email_verified }} }
```

Only `email_verified: true` counts. Such a person, next to an active
membership of their own, gets `staff: true`: `list_my_workspaces(search=...)`
finds the workspaces dForms already knows (by name, a member's email or a
form's name; at least 3 letters or digits, at most 20), and naming one in
`workspace_id` acts there as an `admin` through a staff access grant, minted
on first use exactly as the web switcher does. Staff name the workspace on
every call. A membership of their own there that is not active is never
replaced (`MEMBERSHIP_NOT_ACTIVE`), and only workspaces the identity service
owns and dForms has synced are listed or entered. Every staff call says
`access: 'staff'`, its text starts `In workspace "<name>" (staff access):`,
and the audit line carries `via: 'staff_grant'`. A token without the verified
email is not staff, and the grants entered this way are out of reach from
that token on.

Without the template, staff reach only what [ADR
0003](adr/0003-mcp-sign-in-maps-through-web-logins.md) allows: a customer
workspace they opened on the web as staff within the last day, as staff
access, only next to an active membership of their own. A workspace where the
person is a real member is always entered as that member. Staff can also
create an API key in a customer's workspace through the API (`/v1/api-keys`,
with their session), which works over MCP like any key: in that workspace
only, as the grant's `admin` row, until someone revokes it; the workspace's
owners and admins see such keys marked as created by Dapta staff.

## Tools

| Tool | Kind | What it does |
|---|---|---|
| `whoami` | read | Who is connected (the key prefix, or the person signed in), every workspace it can act in with the role there, whether the person is `staff`, `next_step`, and, when a workspace applies, that workspace (with its `access`) and the member it acts as (every field `GET /v1/me` documents, `status` and `locale` included). |
| `list_my_workspaces` | read | The workspaces this connection can act in: id, name, account name, role and access, plus what to do next. `search` filters them by name; for staff it searches every workspace dForms knows (see [Staff](#staff)). `limit` caps the list (default: all); `truncated` says when more applied. With a key, the key's one workspace. |
| `list_forms` | read | Forms, most recently updated first, with id, `public_url`, whether edits are unpublished and `is_live` (false when the live version has no steps, so the link opens an empty form). Filter by name, ignoring case and accents; page with `limit`/`offset`. |
| `get_form` | read | One form: `public_url`, publish state, `is_live` and the config to edit (the pending draft when there is one). `destinations` are left out of the config and listed apart (the live form's, with their ids, secrets masked): the list `set_destinations` starts from. |
| `create_form` | write | Creates a form from a full config. It is live at once; the result carries its `public_url`, and a warning when dForms filled `branding` in. Not idempotent. |
| `update_form` | write | Saves a new config as an unpublished draft (and can rename). Requires `expected_updated_at`; a form saved elsewhere since answers `STALE`. |
| `publish_form` | **destructive** | Makes the draft live, replacing what respondents see. The replaced version is kept for `revert_form`. A retry after the publish went through answers `nothing_published`, not `STALE`. |
| `revert_form` | **destructive** | Puts the previously published version back live; a second revert undoes the first. It rolls back a publish, never unpublished edits. |
| `discard_draft` | **destructive** | Throws away the unpublished draft, so the form goes back to its live version. What respondents see does not change. |
| `list_responses` | read | A page of responses: status, score, outcome, times, and the answers under `respondent_supplied`, each with its `step_key` and `type`. Answers to steps the form no longer has stay, marked `step_removed`. |
| `get_form_analytics` | read | The funnel the Results screen shows (views, starts, submissions, completion rate, median time, partials, bookings, drop-off per question), each metric with its definition, and `warnings` when the numbers do not add up as a funnel (responses created through the API). |
| `get_form_guide` | read | The rules, how to choose a workspace, step types, logic, the config JSON Schema and worked examples. |

Beyond these, there is one tool for every other route the API reference
documents (`API_REFERENCE` in `@quill/shared`), so an agent
can do over MCP whatever a key can do over REST. Each runs the same handler as
its REST route, with the same role rule and the same masking.

| Area | REST route | Tool | Kind |
|---|---|---|---|
| Forms | `PUT /v1/forms/:id/slug` | `set_form_slug` | write |
| Forms | `POST /v1/forms/:id/duplicate` | `duplicate_form` | write |
| Forms | `PATCH /v1/forms/:id/folder` | `move_form` | write |
| Forms | `DELETE /v1/forms/:id` | `delete_form` | **destructive** |
| Folders | `GET /v1/folders` | `list_folders` | read |
| Folders | `POST /v1/folders` | `create_folder` | write |
| Folders | `PATCH /v1/folders/:id` | `rename_folder` | write |
| Folders | `DELETE /v1/folders/:id` | `delete_folder` | **destructive** (forms are unfiled, never deleted) |
| Destinations | `PUT /v1/forms/:id/destinations` | `set_destinations` | **destructive** (replaces the list; secrets come back masked) |
| Destinations | `POST /v1/forms/:id/destinations/webhook/ping` | `ping_webhook` | write, owners and admins (the endpoint's status; sample answers for input steps, in the phase the webhook listens to, `test: true` at the top) |
| Responses | `GET /v1/forms/:id/submissions/:submissionId` | `get_response` | read |
| Responses | `GET /v1/forms/:id/submissions/:submissionId/files/:stepKey` | `get_response_file` | read (a short-lived link, never the bytes) |
| Responses | `GET /v1/forms/:id/submissions.csv` | `export_responses_csv` | read (CSV text, at most `max_rows` rows and 100,000 characters counting the header, the first row always whole, with `truncated`; only those rows are read) |
| Responses | `POST /v1/forms/:id/submissions/bulk-delete` | `delete_responses` | **destructive** |
| Responses | `DELETE /v1/submissions/:id` | `delete_response` | **destructive** |
| Responses | `GET /v1/forms/:id/deliveries` | `list_deliveries` | read (failed and skipped unless `status` says otherwise) |
| Analytics | `GET /v1/forms/:id/summary` | `get_form_summary` | read |
| Analytics | `GET /v1/forms/:id/submissions-facets` | `get_response_facets` | read |
| Analytics | `GET /v1/forms/:id/summary/:stepKey/answers` | `search_answers` | read |
| Brand kit | `GET /v1/branding` | `get_brand_kit` | read |
| Brand kit | `PUT /v1/branding` | `update_brand_kit` | write, owners and admins |
| Brand kit | `POST /v1/branding/apply` | `apply_brand_kit` | **destructive**, owners and admins |
| Brand kit | `POST /v1/branding/revert` | `revert_brand_kit` | **destructive**, owners and admins |
| Link pages | `GET /v1/link-page` | `get_link_page` | read (the default page, or the one `page_id` names: the stored page or null, the workspace's forms, the brand kit, `public_url` and `live`) |
| Link pages | `GET /v1/link-pages/:id` | `get_link_page` (with `page_id`) | read |
| Link pages | `PUT /v1/link-page` | `update_link_page` | **destructive**, open world (replaces the whole default page; `page: null` deletes it when it is the only page; any member) |
| Link pages | `PUT /v1/link-pages/:id` | `update_link_page` (with `page_id`) | **destructive**, open world (content, `name`, `slug` with a redirect from the old one, `make_default`) |
| Link pages | `GET /v1/link-pages` | `list_link_pages` | read (every page, the default first, with `page_id`, `public_url` and `live`) |
| Link pages | `POST /v1/link-pages` | `create_link_page` | write, open world (at most 20 pages; the first one becomes the default) |
| Link pages | `POST /v1/link-pages/:id/duplicate` | `duplicate_link_page` | write (the copy is unpublished) |
| Link pages | `DELETE /v1/link-pages/:id` | `delete_link_page` | **destructive**, open world (never the default page) |
| Notifications | `GET /v1/notifications` | `list_notifications` | read, owners and admins |
| Notifications | `PUT /v1/notifications/:emailKey` | `update_notification` | write, owners and admins |
| Notifications | `POST /v1/notifications/:emailKey/reset` | `reset_notification` | **destructive**, owners and admins |
| Notifications | `GET /v1/forms/:id/notifications` | `list_form_notifications` | read, owners and admins |
| Notifications | `PUT /v1/forms/:id/notifications/:emailKey` | `update_form_notification` | write, owners and admins |
| Notifications | `POST /v1/forms/:id/notifications/:emailKey/reset` | `reset_form_notification` | **destructive**, owners and admins |
| Integrations | `GET /v1/integrations` | `list_integrations` | read |
| Integrations | `GET /v1/integrations/webhooks` | `list_webhooks` | read |
| Integrations | `GET /v1/integrations/hubspot/properties` | `list_hubspot_properties` | read (calls HubSpot) |
| Integrations | `GET /v1/integrations/calendly/event-types` | `list_calendly_event_types` | read (calls Calendly) |
| Identity | `GET /v1/me` | `whoami` | read |
| Identity | `GET /v1/me/profile` | `get_my_profile` | read |
| Identity | `GET /v1/vanity` | `get_workspace_link_code` | read |

The other routes of the reference map to the tools above: `GET /v1/forms` to
`list_forms`, `POST /v1/forms` to `create_form`, `GET /v1/forms/:id` to
`get_form`, `PUT /v1/forms/:id` to `update_form`, the publish and revert
routes to `publish_form` and `revert_form`, `GET /v1/forms/:id/submissions` to
`list_responses` and `GET /v1/forms/:id/analytics` to `get_form_analytics`.
`API_ROUTE_TOOLS` in `@quill/mcp` holds the mapping, and a spec in the API
fails when a route added to the reference has no tool and is not on the
explicit exclusion list (`API_ROUTE_EXCLUSIONS`, empty today). The summary is
not left out as a duplicate of `get_form_analytics`: that one is the session
funnel, while the summary counts what responses answered, question by
question.

Every tool carries a title, `readOnlyHint` / `destructiveHint` /
`idempotentHint` / `openWorldHint`, an input schema and an output schema with
`structuredContent`. The content of a result is a short text summary followed
by the same data as JSON text, for clients that only read text. Nothing changes
keys, members, workspaces, the profile, the language, the workspace link code,
or connects and disconnects an integration: those stay in the dashboard, as
they do for a key over REST.

Every tool marked **destructive** says so in its description and tells the
agent to name what will change and wait for the user's yes before calling it,
and never to repeat it on its own after an error.

Every role (owner, admin, member) can create, edit, publish, delete and
organise forms in the web app, so every role's key can use those tools. The
routes the API keeps to owners and admins (the brand kit writes, the
notification emails, the webhook test) answer `FORBIDDEN` to a member through
the MCP exactly as over REST, because the tools run the API's own handlers.

### Writing a config

- `create_form` and `update_form` validate against the real form contract plus
  the rules every API key is held to: no field the editor cannot show
  (`UNSUPPORTED_FIELD`), no step without a question (`EMPTY_QUESTION`), never a
  config without `steps` on an update (`STEPS_REQUIRED`). A refusal answers
  `VALIDATION_FAILED` with every problem on its own line, path first
  (`config.steps.2.question`), so a model fixes them all in one retry.
- On top of that, the MCP refuses what the API would otherwise change without
  a word, each with its path and what to do: a field outside the config schema
  (`unrecognized_keys`), a repeated step key, option value or outcome id
  (`DUPLICATE_KEY`, `DUPLICATE_VALUE`, `DUPLICATE_ID`), a `goto` to a step that
  does not exist or does not come later (`UNKNOWN_STEP`, `INVALID_TARGET`), a
  condition on a step that does not exist (`UNKNOWN_FIELD`), `@score` with op
  `in` (`SCORE_OP`) and a min above its max (`MIN_ABOVE_MAX`). An
  `update_form` that leaves `branding` out of a form that has one answers
  `BRANDING_MISSING` (send it back as read, or `null` to remove it). A problem
  of these kinds that the form already had in the config the agent read is
  saved as it was, with a warning, so an editor-built form never blocks an
  edit; one the API refuses anyway says it came with the form. The REST API
  keeps its v1 behaviour for all of these.
- `update_form` ignores `destinations` and says so in `warnings`: change them
  with `set_destinations`, starting from `get_form`'s `destinations`.
- A refusal points at `get_form_guide` only for a form config (`create_form`,
  `update_form`); the brand kit, notification and destination tools name the
  field and what to send instead.
- `update_notification` and `update_form_notification` save a `{{token}}` the
  emails do not know, as the REST API does, and list it in `warnings` with
  the valid ones: it reaches the inbox as written.
- A question that recalls an answer (`Tu email, [firstname]`) is filled in per
  response by `list_responses` and `get_response`; a CSV header, the summary
  and the funnel name it as written, since each respondent's value differs.
- What is saved is the engine's normalized config, the same shape the editor
  saves, so everything an agent writes opens and edits in the dForms editor.
- Forms created through the MCP record `created_via = 'mcp'`.

### Dates

`list_responses` and `get_form_analytics` take `from`/`to` as a day
(`YYYY-MM-DD`) or epoch milliseconds (an ISO instant works too).
A value dForms cannot read (`2026-13-45`, `yesterday`, epoch seconds), a
`from` after `to` or an unknown `time_zone` answers `VALIDATION_FAILED`
instead of reading everything. With `include_daily`, `daily_truncated` says
when `daily` is at its 366-day cap and the range may hold earlier days.

### Untrusted text

Answers are typed by members of the public, so they are hostile input to a
model. `list_responses`, `get_response`, `export_responses_csv`, the summary
and the answer search return them only inside `respondent_supplied` (the
delivery bodies of `list_deliveries` under `untrusted`), with
control and zero-width characters, HTML and markdown links and images removed
(nested ones too, until nothing is left to remove) and every value
length-capped. The CSV keeps its cells as the download has them, minus
zero-width and bidi characters, so it stays a valid CSV. Tell your agent to treat `respondent_supplied`
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
  credentials in the URL (400), `application/json` only (415), a JSON-RPC
  batch (400: one message per request, so a request is one rate-limit token),
  then the key. The same list is the endpoint's CORS policy (preflight
  answered, no credentials), kept apart from the dashboard's `CORS_ORIGINS`:
  neither list opens the other surface. The path is matched in any letter
  case, so `/MCP` gets the MCP policy too.
  Bodies are capped by the API's JSON parser, like every REST route.
- **Rate limits.** Every request of a key takes a token from its MCP bucket
  (`MCP_RATE_LIMIT_*`, HTTP 429 with `Retry-After`); write tools also take one
  from a tighter bucket (`MCP_WRITE_RATE_LIMIT_*`, a `RATE_LIMITED` tool error
  with a delay); and every tool call counts once against the key's 120 calls
  a minute, shared with the REST API (a tool that reads an id before it
  deletes it, like `delete_form`, still counts once). Requests without a valid key take from the
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
- **Usage analytics.** With `PRODUCT_ANALYTICS_KEY` set, forms-api also
  enqueues one `$mcp_tool_call` event per tool call (PostHog's MCP analytics
  names, so no `forms_` prefix, and `$mcp_server_name: 'dForms'`) through the
  analytics outbox: tool name, error
  flag and lowercased error code, duration, protocol version, client name,
  version and user agent, `credential_type` (`api_key` or `oauth`) and
  `staff_access`, grouped by `forms_account` and sent under the member's email
  (a connection with no workspace yet: under its digest, `unlinked:<hex>`,
  with no person profile, so it counts apart from the same person once
  linked). Never the arguments, the result, an error message, or a workspace
  or form name. Reporting is never awaited by the tool call, and without the
  key nothing is enqueued.
- **Error logs.** An unexpected failure is logged with its error class and
  code only (`TypeError code=SQLITE_BUSY`), never its message or stack, which
  can quote data from the request.

## Signing in (MCP connections over OAuth)

Chat apps (Claude.ai, ChatGPT) cannot send a header, so with
`MCP_OAUTH_PROVIDER=workos` the endpoint also takes an access token from the
deployment's WorkOS AuthKit. dForms is only the resource server: AuthKit runs
the login, registers the client and issues the token; dForms verifies it.

- **Discovery.** A request without a credential, or with anything that is
  not an API key and does not verify (a header that is not a plain
  `Bearer <token>` included), gets a 401 with
  `WWW-Authenticate: Bearer resource_metadata="<origin>/.well-known/oauth-protected-resource/mcp"`.
  That document (RFC 9728) names `MCP_PUBLIC_URL` as the resource and AuthKit
  as the authorization server. The same document is served at the root,
  `/.well-known/oauth-protected-resource`, for clients that look there, and
  `/.well-known/oauth-authorization-server` forwards AuthKit's own
  authorization server metadata (RFC 8414) for older clients that look for it
  on the MCP host. All three answer 404 with the provider unset or the
  endpoint disabled, and the last one 503 while AuthKit cannot be read.
- **Routing.** The MCP host (the host of `MCP_PUBLIC_URL`) must send
  `/.well-known/*` to the API, not only `/mcp`, or a client cannot find the
  login.
- **The token.** RS256, signed by a key AuthKit publishes at
  `<WORKOS_AUTHKIT_DOMAIN>/oauth2/jwks`; `iss` must be `WORKOS_AUTHKIT_DOMAIN`,
  `aud` must be `MCP_PUBLIC_URL`, `sub` and `exp` are required, and a `crit`
  header is refused. Anything else is a 401 that points at the login again.
  The keys are cached: fetched once on a cold start, again when a token names
  a key id the set lacks (at most once every 30 seconds), so a rotated key is
  picked up within that. While AuthKit's keys cannot be read and none are
  cached, a signed-in request gets a 503 with `Retry-After`, not a 401.
- **Both credentials, one URL.** A bearer that starts with `dforms_` is an API
  key and takes the key path, unchanged; any other is an access token. A
  revoked key gets the key's 401, which never points at the login.
- **Who it acts as.** The token's `sub` is the person's WorkOS user id. The
  identity service's session token carries the same id (`workos_user_id`),
  and every verified web request records it on the member it acts as, when
  that member is bound to the same person the session token names
  (`member.idp_subject`, written only when missing or different), and stamps
  when the identity service vouched for that member (`member.login_seen_at`,
  the session token's issue time, renewed about once a day). A sign-in maps
  to the members carrying its `sub` and the same person's members in other
  workspaces, each only while its own stamp is within
  `OAUTH_LINK_MAX_AGE_DAYS` (30 by default), any active role. When the
  identity service has just confirmed the person's memberships (a fresh, not
  degraded projection), the request stamps every one it confirmed, not only
  the one it acts in. The subject is only ever taken from a session token the
  identity service minted: a session whose token carries none (an older,
  migrated or account-switched session) links nothing until the person signs
  in again. No identity database is read, and no credential for one is held:
  dForms is not told when someone is removed upstream, so MCP access ends
  when the web's would. Each call then acts as that person's member in the
  workspace it names (see [Choosing a workspace](#choosing-a-workspace)),
  with the member's live role, under every rule an API key gets.
- **No workspace yet.** A sign-in that reaches no such member (never used
  the web app, not seen there within the window, or no active membership)
  connects with no workspace, and its tools say to open dForms with that
  account (see [Choosing a workspace](#choosing-a-workspace)). It is never
  refused at `initialize`: chat apps show a refused connect as their own
  error ("Automatic client registration isn't supported"), never our words.
  Its id and rate-limit bucket are a digest of the `sub` (a pseudonym: the
  `sub` itself never reaches a log or analytics line). Unlike the old
  refusal, it no longer charges the per-address bucket: each such sign-in
  has its own bucket, as a linked one does.
- **Refusals.** A `sub` that two different people carry gets a 403 that says
  to contact support. Never a 401, which would only loop the login.
- **Logs.** One line per request of a sign-in with no workspace
  (`mcp.oauth_no_workspace`, the reason: `not_linked` or
  `no_active_membership`, and `person`: the same digest the audit line
  carries) and per refusal (`mcp.oauth_refused`, reason `ambiguous`), never
  the token or the `sub`.
- **Existing members.** A person links on their next visit to the web app,
  with no new login, when their session token carries their WorkOS id. A
  session whose token does not (it predates the claim, or came from an
  account switch) needs a fresh sign-in to the web app once.
- **Limits and audit.** The MCP buckets count per member of the workspace a
  call acts in, so one person's clients share a budget per workspace; a request
  that acts in none (the handshake, the tool list) counts against the person.
  The audit line names the member, the person and the workspace (caller
  `oauth:<person>`), never the token.

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
| `MCP_PUBLIC_URL` | web (runtime); API with `MCP_OAUTH_PROVIDER` (required) | `<PUBLIC_API_URL>/mcp` on the web |
| `MCP_OAUTH_PROVIDER` | API and web (runtime; the web shows the connector guide only with `MCP_PUBLIC_URL` set too) | unset (API keys only; the MCP page says the connector is not available here) |
| `WORKOS_AUTHKIT_DOMAIN` | API | unset (required with `MCP_OAUTH_PROVIDER`) |
| `OAUTH_LINK_MAX_AGE_DAYS` | API | `30` (days after a member's last verified web login that a sign-in may act as it) |
| `IAM_STAFF_DOMAINS` | API (the web app's switcher, and an MCP sign-in whose token carries a verified email) | unset (nobody is staff) |
| `OPENAI_APPS_CHALLENGE_TOKEN` | API (served at `/.well-known/openai-apps-challenge`, OpenAI's domain check for a ChatGPT app) | unset (404) |

## Check it yourself

`pnpm run build:packages && cd apps/api && pnpm e2e:mcp` boots the API the way
the production image does (tsx with `tsconfig.runtime.json`) on a throwaway
SQLite file and plays a whole session with the official client: the anonymous
refusal, a legacy handshake, the tool list, a refused config, a create, a
response submitted through the public API, a draft, a stale write, a publish,
the responses and the funnel, then a key revoked mid-session.
