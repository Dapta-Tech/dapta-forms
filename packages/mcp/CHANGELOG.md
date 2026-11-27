# @quill/mcp

## 0.1.0

### Minor Changes

- 0624475: The API can keep answering on an old host while telling callers to move, and
  show which API keys still use it.

  A deployment that moves its API to a new domain cannot redirect the old host
  while keys still call it: a redirect drops `Authorization: Bearer dforms_...`.
  `API_DEPRECATED_HOSTS` (optional, comma-separated hostnames) names the hosts
  that keep serving but are on their way out. Unset, nothing changes. Set, every
  response on a listed host, errors included, carries `Deprecation` (RFC 9745,
  from `API_DEPRECATION_DATE`), a `Link` to the same path on `API_SUCCESSOR_URL`
  with `rel="successor-version"` and, when `API_SUNSET_DATE` is set, `Sunset`.
  Each call made there with an API key, on the REST routes or on `/mcp`, is
  logged once as a JSON line with the key's id, its workspace, the method, the
  route pattern, the status and the host; never the key and never the query. A
  call without a key gets the headers and no line.

  The host is the `Host` header, compared case-insensitively without the port;
  `X-Forwarded-Host` is not read. Health checks and in-cluster calls use names
  nobody lists, so they are never affected. The successor URL and the
  deprecation date are required with the list, and a malformed entry, a
  successor that is not a plain https origin or lists itself, a bad date, or a
  sunset before the deprecation refuses to boot.

  - `@quill/config`: `API_DEPRECATED_HOSTS`, `API_SUCCESSOR_URL`,
    `API_DEPRECATION_DATE`, `API_SUNSET_DATE`, and `apiDeprecation`, the
    resolved settings (null when off).
  - `@quill/mcp`: `McpDoorOptions.onAuthenticated`, an optional hook called with
    the request and the caller once a credential resolves, before its rate
    limit.

- 11af0cd: Button text color, phone placeholder and no phone focus on a one-page form.

  - `branding.buttonTextColor` (`formBrandingSchema` and `FormBranding`): optional, nullable, validated as a CSS color. The label color of a solid button (`buttonStyle` resolved to `solid`): the Next / Submit button and the CTA of the final screen. Absent, `null` or blank keeps the automatic color that contrasts with `primaryColor`; ignored for `outline` and `soft`. Not part of the brand kit.
  - A `phone` step's `placeholder` now replaces the automatic number mask when it is not blank; absent or blank keeps the mask, which still follows the country.
  - On the one-page layout no question takes focus on load, the phone included, so an embedded form no longer scrolls its host page. Slides is unchanged.
  - i18n (EN + ES): `admin.editor.design.buttonTextColor`, `buttonTextAuto`, `buttonTextLowContrast`.
  - MCP: `branding.buttonTextColor` in the config schema with its description; the `phone` step type explains its placeholder.

- 61067f7: A `checkbox` question type: one native box with text beside it, for a consent line such as "I accept the privacy policy".

  - `FORM_FIELD_TYPES` gains `'checkbox'` (last), so `formFieldType`, the API v1 schema and the MCP schema accept it. No new step fields: `question` is the text beside the box, `required` blocks submit until it is checked, `helper` is an optional line under it.
  - Links in the text as `[text](https://url)`. Only http(s) links render as links (new tab); any other scheme stays literal text. Engine: `parseInlineLinks`, `inlineLinksPlainText`, `isCheckboxChecked`, `isHiddenStep`.
  - Checked stores `true`; unchecked stores nothing (never `false`). `canonicalizeAnswer` turns `'true'` into `true`. A checkbox question is shown as written: no `[key]` tokens and no question variants.
  - Validation: `validateAnswerCode` returns the new code `'consent'` for a required box left unchecked and `'option'` for any other value; `validateAnswer` says "Check the box to continue.". i18n: `renderer.errors.consent` (EN + ES).
  - `hidden`, `defaultValue` and URL prefill have no effect on a checkbox: it always shows and always starts unchecked.
  - `goto` and `terminal` have no effect on a checkbox either: `resolveGoto` and `answeredPath` skip them, and `resolveStepDisplay` drops both from the resolved step.
  - Answers: a check in the table, the CSV, the response panel, the owner email and the MCP; the column header shows the links as their text (`stepLabel`, `summarizeAnswersByStep`). `stepLabel` accepts an optional `type`.
  - MCP `get_form_guide`: the `checkbox` step type and a note that its question takes no placeholders.

- c9cdb1e: `set_destinations` reports what the save did to the spreadsheet's header row.

  - The MCP tool `set_destinations` returns `sheet_header_row`, the same outcome the REST route returns as `sheetHeaders`: `written`, `unchanged`, `stale`, `foreign` (row 1 holds something dForms did not write and was left untouched, with what it holds under `sheet_supplied`) or `failed` with its reason. An agent that changes a Google Sheets destination's columns can now tell that row 1 was left alone. The tool description and the agent guide say so, and describe the Google Sheets destination.
  - New catalog strings, in English and Spanish, for what a member is told where an action is for owners and admins, and for a connect attempt that failed with no specific reason.

- a463b72: `@quill/shared`: English and Spanish copy for the CRM cards' "send partial responses too" switch, its Salesforce warning and the Google Sheets complete-only note. `@quill/mcp`: the published form config schema keeps `events` on HubSpot and Salesforce destinations, and `set_destinations` describes it and each kind's default.
- d6427bf: Agents can configure a HighLevel destination through the MCP.

  - `@quill/mcp`: `list_integrations` lists HighLevel with the connected sub-account (`label`, `locationId`, last 4 of the token), names it in `not_connected` when it is not, adds `rejected` (connected, but the provider stopped accepting the credential: HighLevel after a 401 or 403) and `integrations_url`, the dashboard page where an owner or admin connects it by pasting a Private Integration token. No tool connects it.
  - `@quill/mcp`: new tool `list_gohighlevel_fields`: the standard contact fields and the sub-account's mappable custom fields (`id`, `key`, `name`, `dataType`, `options`), with `refresh` to skip the 5-minute copy, and `enabled: false` with `reason` (`not_connected`, `rejected`), a sentence and the dashboard page when it cannot list them.
  - `@quill/mcp`: `set_destinations` and `create_form` describe the HighLevel destination (standard and custom targets, tags, source, UTMs to text fields, the score to a number field, the submitted date to a date field, no fixed value on email or phone, `events` with partials off by default), and the guide's `config_schema` and the skill's `form-config.schema.json` publish its variant. A HighLevel refusal for a workspace that has not connected it carries the usual hint: hand the user the page, then send the call again.
  - `@quill/shared`: the API reference documents `GET /v1/integrations/gohighlevel/fields`, in English and Spanish, and the MCP tool catalog names the new tool.

- eee1507: The workspace link page through the MCP and the API reference.

  - `@quill/mcp`: two tools, `get_link_page` (read only: the stored page or null, the workspace's forms, the brand kit, `public_url` and `live`) and `update_link_page` (replaces the whole page, `page: null` deletes it; destructive and open world, so the agent confirms first). Both run the REST handlers in process and any member can use them. A form button naming a form outside the workspace answers `NOT_FOUND` instead of being dropped. The catalog now has 49 tools.
  - `@quill/shared`: `GET /v1/link-page` and `PUT /v1/link-page` in `API_REFERENCE` under a new `linkPage` area, their EN and ES docs prose and Tools page copy, and `linkPageUrl()` for the page's public address.

- ddd4140: The MCP serves every route the API docs page documents: 35 new tools beside the first eleven, one per route of `API_REFERENCE`.

  - Forms: `set_form_slug`, `duplicate_form`, `move_form`, `delete_form`. Folders: `list_folders`, `create_folder`, `rename_folder`, `delete_folder`. Destinations: `set_destinations`, `ping_webhook`.
  - Responses: `get_response`, `get_response_file` (a short-lived link, never the bytes), `export_responses_csv` (the CSV text, capped by `max_rows` and 100,000 characters, with `truncated`), `delete_responses`, `delete_response`, `list_deliveries`. Analytics: `get_form_summary`, `get_response_facets`, `search_answers`.
  - Brand kit: `get_brand_kit`, `update_brand_kit`, `apply_brand_kit`, `revert_brand_kit`. Notifications: `list_notifications`, `update_notification`, `reset_notification`, `list_form_notifications`, `update_form_notification`, `reset_form_notification`. Integrations, read only: `list_integrations`, `list_webhooks`, `list_hubspot_properties`, `list_calendly_event_types`. Identity: `get_my_profile`, `get_workspace_link_code`.
  - Deletes, resets, `set_destinations` and the brand kit apply and revert carry `destructiveHint`, and their descriptions tell the agent to name what will change and wait for the user's yes. A 404 names what was missing (form, folder, response, file, question), and `NAME_TAKEN`, `SLUG_TAKEN` and `NO_WEBHOOK` say what to do next.
  - Text from the public (answers, file names, delivery bodies, the summary's latest answers) comes back cleaned under `respondent_supplied` or `untrusted`. The audit line redacts the new content-bearing arguments too.
  - `ApiParityBackend` is the port for these routes; `FormsBackend` extends it. `CATALOG` is what the server registers (the core `TOOLS`, then `PARITY_TOOLS`), and `API_ROUTE_TOOLS` maps each documented route to its tool, with `API_ROUTE_EXCLUSIONS` (empty) for any left out on purpose.
  - The server instructions and `get_form_guide` mention the new tools, the confirm-first rule and the owner and admin routes.

- 476e9f3: MCP tools tell the truth about integrations that cannot deliver.

  - `set_destinations` reports `warnings`: every enabled entry that was saved but delivers nothing yet, because its provider is not connected or a spreadsheet entry has no sheet or no headed column. A refusal with `INTEGRATION_NOT_CONNECTED` carries the dForms integrations page, since connecting Google or Salesforce only happens in a browser. Its description now covers Google Sheets and Salesforce, with the Salesforce destination shape.
  - `create_form` is held to the same rule for the destinations in its config, and reports a spreadsheet destination with no sheet yet in `warnings`.
  - `list_integrations` names all four providers (HubSpot, Calendly, Google Sheets, Salesforce), lists the ones not connected and the ones the deployment cannot connect (`unavailable`, reported there only, never as connected or not connected), and says whether the deployment has dCal.
  - New `list_event_types` tool with a `provider` of `calendly` or `dcal`. Calendly event types are listed as before. dCal event types need a signed-in Dapta session, which no MCP credential carries, so `dcal` answers with that reason and the editor as the place to pick the event. `list_calendly_event_types` keeps working unchanged under its first name.
  - The form guide documents `dcal` as a scheduler provider and says new scheduler steps default to it.
  - The API docs describe the new refusal and the `unavailable` and `dcal` fields of `GET /v1/integrations`.

- 620ae1b: The MCP door can take MCP connections signed in through OAuth next to API keys, and a connection can act in every workspace where the person holds an active member.

  - `@quill/mcp`: `McpDoorOptions.oauth`, the door's OAuth side (`isApiKey`, `authenticate`, `resourceMetadataUrl`). A bearer it recognizes as an API key takes the key path, unchanged, and a dead key gets the key's 401, which never points at a login. Anything else is the OAuth side's: a request without a credential, a header that is not a plain `Bearer <token>`, or a token that does not verify gets a 401 whose `WWW-Authenticate` carries `resource_metadata` (RFC 9728), so a client can find the login. The `challenge` option is gone. Without `oauth`, the door behaves exactly as before.
  - `@quill/mcp`: the OAuth side resolves an `McpConnection`: the person (`personId`, `email`), with one `McpCaller` per workspace they may act in. It can throw `DoorRefusal` (a 403 with its message, for a sign-in that verifies but names nobody the host knows), `DoorUnavailable` (a 503 with its message and `Retry-After: 30`, for a sign-in that cannot be checked right now, never a 401 that would start a new login) or `DoorThrottled` (a 429 with `Retry-After`, for lookups past their budget). Each of the three is also charged to the client address.
  - `@quill/mcp`: new tool `list_my_workspaces` (name, role and id). Every tool that acts in a workspace takes an optional `workspace_id`: an API key keeps its own workspace and refuses any other (`WORKSPACE_MISMATCH`); a connection with several workspaces must name one (`WORKSPACE_REQUIRED`, which points at `list_my_workspaces`), uses its only one without asking, and answers `NOT_FOUND` for any workspace it cannot act in. A connection with no workspace is let in, and its tools answer `NO_WORKSPACE` with what to do. Every result names the workspace it acted in, in the structured content and the text summary. `whoami` reports the person and every workspace, with `key: null` for a connection, and `get_form_guide` explains how to choose a workspace.
  - `@quill/mcp`: the door counts a connection's requests per member of the workspace each call names (or its only one), and a request that acts in none against the person; write tools take their token from the same member. The audit line names the person, the member and the workspace, never the token. `McpCaller` carries `workspaceName` and, for a connection, `personId`.
  - `@quill/mcp`: tool errors speak to the credential that made the call: a signed-in person is never told about a key or a key's owner (`FORBIDDEN`, `RATE_LIMITED`, `INVALID_API_KEY`). `toFailure` takes the credential kind. `FormsMcpServerOptions.appUrl` names the address a person opens to get a first workspace, and `openDFormsOnce` is the one wording for it.
  - `@quill/db`: `findApiKeyPrincipal` also returns the key's workspace name (`accountName`). `listWorkspacesForIdentity` keeps an account's active member before an invited one when it collapses to one row per account, so a stale invitation no longer hides a membership that works, and takes `emailOnlyWhenUnbound`, which matches by email only a member that nobody holds yet or that this same person holds.

- af7d5c2: The MCP no longer answers OK when it did something other than what an agent
  asked.

  - `discard_draft` (new tool) throws away an unpublished draft so the form goes
    back to its live version. `revert_form` now says it only rolls back a
    publish and must never be used to undo unpublished edits.
  - `list_responses` and `get_form_analytics` refuse a `from` or `to` they
    cannot read (an impossible day, a word, epoch seconds), a `from` after `to`
    and an unknown `time_zone`, instead of reading everything.
  - `get_form`, `list_forms` and every form result carry `is_live` and
    `live_step_count`; a form never published with a step is named in the
    summary so its empty link is not shared.
  - `create_form` and `update_form` refuse, path by path, what the API would
    otherwise change without a word: unknown fields, repeated step keys, option
    values and outcome ids, a `goto` or condition naming a step that does not
    exist, `@score` with op `in`, a min above its max. `update_form` refuses to
    drop the form's `branding` (`BRANDING_MISSING`, `null` removes it on
    purpose) and warns when it ignores `destinations`; `create_form` says when it
    filled `branding` in. A problem of these kinds the form already had in the
    config the agent read is saved as it was, with a warning; one the API
    refuses anyway says it came with the form. The REST API keeps its v1
    behaviour.
  - A `publish_form` with no draft pending answers `nothing_published`, and a
    retry after it went through answers that instead of `STALE`.
  - `list_responses` gives each answer its `step_key` and `type`, each completed
    response its `outcome`, and keeps answers to removed steps (`step_removed`).
  - `get_form_analytics` warns when the funnel does not add up (responses
    created through the API), flags `daily_truncated`, and names the first
    drop-off row "(form opened)".
  - `list_forms` matches names without regard to accents, `get_form` leaves
    `destinations` out of the config, and the guide's config schema speaks of
    `create_form` and `update_form` (`formConfigJsonSchema('mcp')`).
  - `@quill/mcp`: `FormsBackend.discardDraft`, and the optional
    `FormListItem.liveStepCount`, `ResponseItem.outcome` and
    `ResponseAnswer.stepKey`, `type` and `stepRemoved`.
  - `@quill/db`: `discardDraft` and `listLiveStepCounts`.
  - `@quill/engine`: `summarizeAnswersByStep`, the summary rows with each
    step's key and type; `summarizeAnswers` is built on it and unchanged.
  - `@quill/shared`: `POST /v1/forms/:id/discard-draft` in the API reference,
    with its description in English and Spanish. An API key may call it.

- 55beb72: The dForms MCP server: `POST /mcp` on the API, with the workspace API keys (`Authorization: Bearer dforms_...`).

  - New `@quill/mcp` package: ten tools (`whoami`, `list_forms`, `get_form`, `create_form`, `update_form`, `publish_form`, `revert_form`, `list_responses`, `get_form_analytics`, `get_form_guide`), each with a title and the read-only, destructive, idempotent and open-world hints. No delete tools. Stateless Streamable HTTP on the official TypeScript SDK, serving 2026-07-28 clients and 2025-era `initialize` clients.
  - The tools run the API's own form handlers in process, so an agent is held to every rule the web and the REST API apply: the workspace comes from the key (another workspace's form is `NOT_FOUND`), the member's current role, the strict API-key validation and the normalized config. A refused config answers `VALIDATION_FAILED` with every problem and its path. Forms created through the MCP record `created_via = 'mcp'`, and their product events carry `via: 'mcp'`.
  - The door refuses anonymous requests (401 with a `Bearer` challenge), bad or revoked keys (401, never downgraded), credentials in the URL (400), browser origins outside `MCP_ALLOWED_ORIGINS` (403), a `Host` outside `MCP_ALLOWED_HOSTS` when set (403), anything but a JSON `POST` (405, 415), and a key past its bucket (429 with `Retry-After`). Write tools have a tighter bucket and every call has a timeout. One audit line per tool call, with the key prefix and a hash of the redacted arguments, never the key or any content.
  - Responses come back inside `respondent_supplied`, cleaned of control characters, HTML and markdown links and cut to length. Analytics come back with the definition of every metric.
  - `@quill/mcp/guide` holds the config JSON Schema, the rules and the examples, shared with the API skill zip.
  - `@quill/config`: `MCP_ENABLED`, `MCP_ALLOWED_ORIGINS`, `MCP_ALLOWED_HOSTS`, `MCP_RATE_LIMIT_CAPACITY`, `MCP_RATE_LIMIT_REFILL_PER_SEC`, `MCP_WRITE_RATE_LIMIT_CAPACITY`, `MCP_WRITE_RATE_LIMIT_REFILL_PER_SEC` and `MCP_TOOL_TIMEOUT_MS`, all optional; a blank value reads as unset.
  - `@quill/shared`: the setup guide on the MCP page now connects Claude Code, Codex and Cursor to the MCP server (the key in `DFORMS_API_KEY`, then each agent's entry, with a one-click link for Cursor), in English and Spanish. The skill zip stays as the way in for agents without MCP. The web app reads the address at runtime from `MCP_PUBLIC_URL`, else the public API address plus `/mcp`.

- a690bc0: Staff of the deployment can work in any workspace over an MCP connection.

  - `McpConnection.staff` (`McpStaffAccess`): set by the host only when the person is staff on that request. `search(query, limit)` finds workspaces of the whole deployment; `enter(workspaceId)` returns a caller for a workspace the person is not a member of (through a staff access grant), or null. `McpCaller.access` is `'staff'` for such a caller.
  - `resolveWorkspace` is now async. Staff always name a workspace (`WORKSPACE_REQUIRED` otherwise, even with one of their own); a `workspace_id` outside their own goes through `staff.enter`, and one no live workspace has answers `NOT_FOUND`. People who are not staff, and API keys, behave exactly as before.
  - `list_my_workspaces` takes `search` and `limit` (default: every workspace that applies; the result says how many were left out). Each workspace carries `account_name` and `access` (`member` or `staff`), and the result says whether the person is `staff`. For staff, `search` covers every workspace: at least 3 letters or digits (`SEARCH_TOO_SHORT` otherwise), at most 20 results, never the full list. `whoami` says `staff` too.
  - A result acted in through staff access names its workspace with `access: 'staff'` and starts `In workspace "<name>" (staff access):`; its audit line carries `via: 'staff_grant'`.
  - The server instructions, `whoami`, `list_my_workspaces` and the guide tell the agent to confirm the workspace with the user before the first call that reads or changes anything in it, even when only one matched.
  - Every tool of the catalog, the parity tools included, resolves its workspace the same way, so staff can use all of them in a workspace they are not a member of.
  - `whoami`'s `member` now carries every field `GET /v1/me` documents: `status` and `locale` join `id`, `name`, `email` and `role`. `WhoAmI` gains `status` and `locale`.
  - New exports: `normalizeWorkspaceSearch`, `STAFF_SEARCH_MIN_CHARS`, `STAFF_SEARCH_MAX_RESULTS`, `STAFF_WORKSPACE_HINT`.

- 253fdd3: Add an `onToolCall` hook so a host can report MCP usage.

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

- 64f3baa: A workspace can keep several link pages, up to 20 (one per trade fair, one for the Instagram bio, one per country). The default page keeps answering at `/{accountCode}`; every other page answers at `/{accountCode}/p/{slug}`.

  - `@quill/db`: a new `link_page` table and a `link_page_alias` ledger (migration `0027_link_pages`, both dialects, additive). The migration copies every existing `account.link_page` into a default page with the slug `main` and the exact same content, so every existing page keeps its address and what it shows. `account.link_page` stays readable as a fallback for one release and is kept in step with the default page. Exactly one default page per workspace (a partial unique index), slugs unique per workspace, at most 20 pages, the default page cannot be deleted, and a renamed slug keeps redirecting to the new one.
  - `@quill/types`: `linkPageSlugSchema` (the vanity slug rules and reserved words), the create, update and duplicate bodies, `LinkPageSummary`, `LINK_PAGE_MAX_PAGES`, and an optional `colors` field on a page (its own primary, background and text colours over the brand kit; absent keeps the kit's). `PublicLinkPage` gains `pageSlug` and `isDefault`.
  - `@quill/shared`: `linkPageUrl()` takes the page, the API reference documents `/v1/link-pages`, and the catalog gains the page list and the editor's name, address and colour fields, in English and Spanish.
  - `@quill/mcp`: `list_link_pages`, `create_link_page`, `duplicate_link_page` and `delete_link_page`; `get_link_page` and `update_link_page` take an optional `page_id` (the default page when absent, as before) and `update_link_page` can rename a page, change its slug or make it the default.

- b8ff7fb: One-page forms built for an embed can drop their chrome: the header, the answered counter, and a count that started above zero.

  - `branding.showHeader` (new, optional). Only the `vertical` layout reads it. `false` removes the header above the questions (the form logo, or the form name when there is no logo), and the logo on the reveal and submitting screens. Absent or `true` keeps today's header. `slides` ignores it. `resolveDesign` resolves it to `true` when absent; no new `data-pf-*` attribute, so existing markup is unchanged. It is not part of the brand kit.
  - `progressStyle: "none"` on a one-page form now hides the whole progress strip, the "X of N answered" label included, not only the bar. Any other value keeps the bar and the label. A one-page form that already stores `"none"` loses its counter.
  - The answered counter no longer counts a value the page put there: a question's `defaultValue` and a URL prefill only count once the person touches the question. A terminal question with a default or a prefill no longer cuts the page on load.
  - Design tab: a "Show header" switch on one-page forms, and the progress toggle offered there with two options (Bar, Hidden). i18n: `admin.editor.design.showHeader` and `showHeaderHint` (EN + ES).
  - MCP `get_form_guide`: descriptions for `branding.showHeader` and `branding.progressStyle` in `config_schema`, and a rule for embedded one-page forms.

- f790dda: One-page forms can look like a regular web form: two short fields side by side, a label above each name input, and compact spacing.

  - `steps[].width` (new, optional: `'full' | 'half'`). Only the `vertical` layout reads it. Two consecutive `half` steps share a row from 640 px wide and stack below that; three in a row make a pair plus a full row, never three columns. Only `text`, `email`, `phone`, `url` and `dropdown` can be half; any other type, a hidden step, or a half step with no half neighbour renders full width. Pairing runs on the live walk, after logic. Engine: `FORM_STEP_WIDTHS`, `HALF_WIDTH_TYPES`, `canHalfWidth`, `onePageRows`.
  - `steps[].fieldLabels` (new, optional, keyed like `placeholders`). On a `name` step in the `vertical` layout, a visible label above each input; the question title stays for screen readers and the response column. A sub-field with no label shows the localized default. Engine: `nameFieldLabels`. Ignored on slides and on any other step type.
  - `branding.density` (new, optional: `'comfortable' | 'compact'`). `compact` drops the lines between questions and spaces fields 16 px apart. `resolveDesign` resolves it to `comfortable` when absent; `designAttributes` is unchanged (the vertical renderer adds `data-pf-density="compact"` itself), so existing markup is byte-identical. Not part of the brand kit. Slides ignores it.
  - Editor: a Width toggle (Full, Half) on short questions of one-page forms, a Label field per name sub-field, and a Density toggle in Design. i18n: `admin.editor.design.density`, `densityHint`, `densityComfortable`, `densityCompact`, `admin.editor.nameStep.label`, `labelHint` (EN + ES).
  - MCP `get_form_guide`: descriptions for `steps.[].width`, `steps.[].fieldLabels` and `branding.density` in `config_schema`, and a rule on making a one-page form look like a regular web form.

### Patch Changes

- a6ae6f7: Groundwork for a HighLevel destination. Nothing can connect or deliver to HighLevel yet, and no screen offers it.

  - `@quill/types`: a `gohighlevel` destination type with its schema (mappings to a standard contact field or to a custom field by id, key and type; UTMs, score and submitted date to custom fields; `dayTimezone`, `staticFields`, `tags`, `source`, `drafts`, `events`), the standard field catalog, the custom field types, which ones each kind of mapping may target (`goHighLevelSlotAccepts`), and the shapes the connect and fields routes and the adapter will use. At most one per form, through `extraOnePerFormDestination`, which also carries the HubSpot and Salesforce rules with their messages unchanged.
  - `@quill/types`: `destinationFiresForPhase` reads an explicit `events` on HubSpot and Salesforce destinations too. Without one, HubSpot still fires on both phases and Salesforce on complete only, so every stored config behaves as before. A HighLevel destination without `events` fires on complete only. Google Sheets stays complete only.
  - `@quill/db`: `gohighlevel` is an integration provider and an outbox kind.
  - `@quill/destinations`: the factory turns a `gohighlevel` delivery into a named no-op until the adapter exists.
  - `@quill/mcp`: the form config JSON Schema (the guide's `config_schema` and the skill's `form-config.schema.json`) leaves out the HighLevel destination and the `events` of HubSpot and Salesforce destinations, which the editor has no control for yet. A refusal for a provider no deployment can connect yet gets its own hint instead of the one that sends the user to whoever runs the deployment.
  - `@quill/shared`: reserved HighLevel copy in English and Spanish: the provider name, the connection errors and the delivery history reasons.

- 2ce25f9: An MCP sign-in that reaches no workspace yet connects instead of being refused at `initialize`. Chat apps showed that refusal as their own error ("Automatic client registration isn't supported"), never our words. Now the connection acts nowhere, every tool says to open dForms once with that account, and the first call after that visit works with no new login or reconnect. A tool that names a `workspace_id`, and `list_my_workspaces` with a search, give the same step when the person has no workspace at all. A `sub` two people carry is still refused.
- 21c78ae: The MCP tools read the way the Claude and ChatGPT connector directories ask for.

  - Behaviour hints: `update_form`, `update_brand_kit`, `update_notification` and `update_form_notification` are destructive (they replace a whole draft or kit, or upsert copy that is lost). `create_form`, `duplicate_form`, `publish_form`, `revert_form`, `set_form_slug`, `delete_form`, `update_brand_kit`, `apply_brand_kit` and `revert_brand_kit` are open world, since each changes a public page.
  - Tool descriptions, argument and result schemas, the server instructions and the `get_form_guide` text say what each tool does, takes and changes instead of giving the model orders. The recommendation to confirm a destructive call with the user stays, said as a recommendation.
  - Behaviour, tool names and the tool count are unchanged.
  - A new spec fails when any tool lacks a title or one of the four hints, when the destructive or open world sets drift, or when a description, a schema, the instructions or the guide holds `ALWAYS`, `NEVER`, `MUST`, `IMPORTANT`, `Do NOT`, "call this first", "before anything" or "ignore earlier instructions".

- ac635ce: Staff workspace search and workspace results, from end-to-end QA:

  - A staff search names each workspace by one id, the identity service's, before and after dForms first projects it. It used to switch to the local id once the workspace had been used, so the same workspace showed up under a new id, which read as a different workspace with the same name. Either id still works as `workspace_id`.
  - Every search result says why it matched (`matched_on`: `name`, `account_name`, `member_email` or `form_name`), so a workspace found by a member's email no longer looks like a wrong hit.
  - `list_my_workspaces` says `truncated: true`, with a `next_step` to narrow the search, when more workspaces matched than it shows.
  - Every result's `workspace` carries `access` (`member` or `staff`), `whoami` included, and `whoami` always has a `next_step`.
  - `WORKSPACE_REQUIRED` and `NOT_FOUND` say "staff of this deployment" once.

- ac635ce: Tool fixes from end-to-end QA:

  - `get_form` lists the form's `destinations` (with their ids, secrets masked), so `set_destinations` has a list to start from, as its description now says.
  - `ping_webhook` reports the status the endpoint answered on success too, and says what the test delivery carries.
  - A refusal points at `get_form_guide` only for a form config; the brand kit, notification and destination tools no longer end with it.
  - `update_notification` and `update_form_notification` list in `warnings` a `{{token}}` the emails do not know (it reaches the inbox as written), with the valid ones.
  - Clearer descriptions: how to clear the brand kit (`{}`, or `null` on the fields that take it), that a `logo` should be https, that `apply_brand_kit` clears the editor's `themePreset` and `revert_brand_kit` brings it back, and that a CSV header or a summary names a question with its `[placeholder]` as written.

- 753a3c6: Every tool result's `workspace.id`, `whoami` included, is now the `workspace_id` the agent sent, trimmed and in lower case. A staff search can return the identity service's id for a workspace, which differs from the dForms id, and an agent that compared the two thought its call had landed in another workspace. Workspace ids are also compared without regard to case, so an API key sent with its own id in capitals is no longer refused as "another workspace".
- 5ddb599: The MCP door trims the trailing slashes of an `Origin` (the request header and the `MCP_ALLOWED_ORIGINS` entries) with a linear loop instead of a backtracking regex, so a long run of slashes in a request can no longer stall it. The comparison is unchanged: trimmed, lower case, no trailing slash. `@quill/shared` now exports `trimTrailing` and `trimChar`, and the web app's public API and MCP addresses use `trimTrailing` too. The MCP test harness answers its 500s as plain text, and the MCP page spec reads the rendered text through an HTML parser instead of stripping tags with a regex.
- 1e99da0: MCP copy and contracts catch up with every destination and scheduler.

  - `list_event_types` takes a required `provider` (`calendly` or `dcal`) with no default: new scheduler steps default to dCal while a step with no provider reads as Calendly, so no default fits every caller. A call without it is refused. `list_calendly_event_types` is unchanged.
  - An `INTEGRATION_NOT_CONNECTED` refusal for a provider the deployment cannot connect at all (Google Sheets without a Google OAuth client) gets its own hint, on `set_destinations` and `create_form`: there is no page to hand over and no retry, so the destination is left out or switched off until whoever runs the deployment sets it up.
  - Descriptions that listed only webhooks and HubSpot (`get_form`, `update_form`) now name Google Sheets and Salesforce too, and the `INVALID_API_KEY` hint no longer sends the user to a dashboard screen for API keys that is gone.
  - The Tools page names Google Sheets, Salesforce and dCal in the integrations group, `list_integrations`, `set_destinations` and `list_event_types`, in English and Spanish.

- 2fd4ed6: MCP review fixes. `get_response` carries the same answer shape (`step_key`, `type`, `step_removed`) and `outcome` as `list_responses`. `list_deliveries` says it reads failed and skipped deliveries by default, as the REST route does, and its summary counts the two apart. `search_answers` steps `next_offset` by the page read, so a page the service trimmed is never read twice. `export_responses_csv` documents that its character cap counts the header and that the first row always comes back. `@quill/db` adds `firstSubmissionsForExport`: the first rows of the CSV export, same filter and order, with the count of the whole export.
- d956ad6: Follow-ups to the MCP QA fixes, from their review.

  - `update_form` no longer says a problem the form already had "is saved as it
    was" when the save changes it. A repeated option value, step key or outcome
    id is renamed, a rule to a missing step (or to the step itself) is removed
    and an unknown field is dropped: each warning now names that exact change
    (for example, the option value saved as `otro_2`) and points at
    `discard_draft`. Only what the API stores untouched still reads "saved as it
    was".
  - `get_form_analytics` counts the days of a range the way the API does (local
    days in the range's time zone), so `daily_truncated` is true whenever the
    daily series was cut, also for epoch-ms bounds.
  - `get_form_analytics` tells apart more submissions than starts (responses
    created through the API) from more starts than views (page views that never
    reached dForms), each with its own warning.
  - The API reference example for `POST /v1/forms/:id/discard-draft` shows
    `updatedAt` after `publishedAt`, as a real discard leaves it.

- df71e1e: Security fixes for the MCP server.

  - The door refuses a JSON-RPC batch (a body that is an array) with 400, so one request can no longer run many tool calls on a single rate-limit token.
  - Credentials in the URL are refused whatever their letter case (`?API_KEY=`, `?Token=`), and `bearer` and `access_key` are on the list too.
  - Text typed by respondents is cleaned until nothing changes, so a nested image or link such as `[![x](a)](https://example.test/p.png)` no longer leaves an image behind. Cleaning a cleaned text changes nothing.
  - Every tool result carries its data as JSON text after the summary, for clients that read only the text content, besides `structuredContent`.
  - `onInternalError` and `onTransportError` receive the error class and code only (`describeError`), never the message or stack, which can quote data from the request.

- 4fd4097: `notePersonLogins` stamps one person's active memberships in the accounts the identity service confirmed and `staffGrantsBySubject` reads the grants an MCP sign-in may reach. The MCP server never uses a workspace reached through a staff access grant without `workspace_id`, even when it is the only one.
- b4990ce: The `steps[].width` description now says half steps pair from 400 px, so they also pair inside a typical embed.
- 1bfeaa1: A form can forward the visitor's UTM parameters to its redirect (#310).

  **Config.** The form-level `ending` takes an optional `forwardUtm` boolean. Absent or `false` changes nothing, so every stored config keeps behaving as before.

  **Engine.** `appendUtm(url, utm)` appends the `utm_*` entries of `utm` to a URL. It ignores every other key, never overwrites a `utm_*` key the owner already wrote (compared case-insensitively), keeps the existing query bytes and the `#hash`, and returns the URL unchanged when there is nothing to append or it does not parse. `forwardedUtm(config, utm)` hands the UTMs through only when `ending.forwardUtm` is on. `resolveEnding` takes a `utm` option and `redirectUrlFor` an optional `utm` argument; both append the UTMs after the `[key]` tokens are filled or stripped.

  **Renderers.** With `forwardUtm` on, both layouts append the same UTMs the submission carried (the form's own, else the landing's) to every redirect: the ending's, an outcome's own `redirectUrl`, and the redirect after a booking, immediate or delayed. The UTMs are forwarded on an embedded form too, because they are campaign data, not answers. The `http(s)` check still runs on the final URL.

  **Editor.** The ending panel shows a "Forward UTM parameters" switch as soon as the form or any score range has a redirect. The redirect hints, in the ending panel and the outcomes dialog, now warn that an answer such as an email placed in the URL ends up in the destination site's browser history and server logs. English and Spanish.

  **Agent docs.** The API skill and the MCP guide document `ending.forwardUtm` and the same privacy warning.

- 98b9031: `normalizeWorkspaceSearch` folds accents, so a staff search for `jose` finds `José` and `JOSÉ`. New exports: `foldSearchText`, and the fold table `SEARCH_FOLD_FROM` / `SEARCH_FOLD_TO` a host applies to names in SQL with `translate(lower(name), FROM, TO)`, which works under collation `C` and needs no extension.
- Updated dependencies [6579900]
- Updated dependencies [35d1586]
- Updated dependencies [310f098]
- Updated dependencies [8985783]
- Updated dependencies [41ec9f2]
- Updated dependencies [7e71117]
- Updated dependencies [8961511]
- Updated dependencies [04d39c0]
- Updated dependencies [38633bb]
- Updated dependencies [ae642c8]
- Updated dependencies [373627e]
- Updated dependencies [5a29839]
- Updated dependencies [4a38827]
- Updated dependencies [bb7077e]
- Updated dependencies [2769426]
- Updated dependencies [67bd1e2]
- Updated dependencies [11af0cd]
- Updated dependencies [2364cd1]
- Updated dependencies [61067f7]
- Updated dependencies [d555b23]
- Updated dependencies [73be7ec]
- Updated dependencies [c9cdb1e]
- Updated dependencies [4c94c6e]
- Updated dependencies [f09c56c]
- Updated dependencies [5eda202]
- Updated dependencies [310f098]
- Updated dependencies [bdc9341]
- Updated dependencies [11d453b]
- Updated dependencies [310f098]
- Updated dependencies [a463b72]
- Updated dependencies [c28dc85]
- Updated dependencies [d69e261]
- Updated dependencies [b612c96]
- Updated dependencies [919dbdb]
- Updated dependencies [531f8d9]
- Updated dependencies [a155476]
- Updated dependencies [9b42f40]
- Updated dependencies [d2a4351]
- Updated dependencies [d25eef2]
- Updated dependencies [f229279]
- Updated dependencies [0217bf8]
- Updated dependencies [468262a]
- Updated dependencies [1d39e94]
- Updated dependencies [e50736f]
- Updated dependencies [7eea7be]
- Updated dependencies [31c6e69]
- Updated dependencies [d58e464]
- Updated dependencies [e877d55]
- Updated dependencies [59f1bbf]
- Updated dependencies [cbcef9c]
- Updated dependencies [8009d2d]
- Updated dependencies [40fe6fe]
- Updated dependencies [b8322ea]
- Updated dependencies [bbf5cdf]
- Updated dependencies [310f098]
- Updated dependencies [acb8823]
- Updated dependencies [42ec808]
- Updated dependencies [0a83bde]
- Updated dependencies [68aa3b2]
- Updated dependencies [a6ae6f7]
- Updated dependencies [d6427bf]
- Updated dependencies [93c6966]
- Updated dependencies [28ab19d]
- Updated dependencies [dc73f54]
- Updated dependencies [ef213f9]
- Updated dependencies [63b7eb5]
- Updated dependencies [66e0b55]
- Updated dependencies [310f098]
- Updated dependencies [bd31b39]
- Updated dependencies [036d5fd]
- Updated dependencies [c3a3154]
- Updated dependencies [f7875dc]
- Updated dependencies [f90861f]
- Updated dependencies [daaabf2]
- Updated dependencies [6855ca8]
- Updated dependencies [4635f39]
- Updated dependencies [7682569]
- Updated dependencies [eee1507]
- Updated dependencies [de8df64]
- Updated dependencies [be7d8d1]
- Updated dependencies [b2f6840]
- Updated dependencies [476e9f3]
- Updated dependencies [5ddb599]
- Updated dependencies [1e99da0]
- Updated dependencies [3913165]
- Updated dependencies [af7d5c2]
- Updated dependencies [d956ad6]
- Updated dependencies [55beb72]
- Updated dependencies [6a396f5]
- Updated dependencies [310f098]
- Updated dependencies [c6007cb]
- Updated dependencies [64f3baa]
- Updated dependencies [65f8aa8]
- Updated dependencies [88795e5]
- Updated dependencies [bfb3d2c]
- Updated dependencies [bfece62]
- Updated dependencies [dd911c2]
- Updated dependencies [0124b1c]
- Updated dependencies [7b087af]
- Updated dependencies [451908b]
- Updated dependencies [b8ff7fb]
- Updated dependencies [f790dda]
- Updated dependencies [310f098]
- Updated dependencies [11435a8]
- Updated dependencies [310f098]
- Updated dependencies [c97e73e]
- Updated dependencies [310f098]
- Updated dependencies [505df64]
- Updated dependencies [dfc514f]
- Updated dependencies [2c41cb0]
- Updated dependencies [a6b7fcf]
- Updated dependencies [91847eb]
- Updated dependencies [d1e9944]
- Updated dependencies [8672c81]
- Updated dependencies [f80a059]
- Updated dependencies [b9de331]
- Updated dependencies [fa5a249]
- Updated dependencies [a108dfd]
- Updated dependencies [f2afb47]
- Updated dependencies [5fb406d]
- Updated dependencies [72a7876]
- Updated dependencies [fb735cd]
- Updated dependencies [310f098]
- Updated dependencies [883ebd2]
- Updated dependencies [cd486b8]
- Updated dependencies [f689309]
- Updated dependencies [a4877c4]
- Updated dependencies [e802b03]
- Updated dependencies [1bfeaa1]
- Updated dependencies [c50ed94]
- Updated dependencies [b20f134]
- Updated dependencies [3bc0d8e]
- Updated dependencies [3795497]
- Updated dependencies [68b0195]
- Updated dependencies [5a00a48]
- Updated dependencies [1d871cf]
- Updated dependencies [bbde00f]
- Updated dependencies [e7aa7f6]
- Updated dependencies [d62a3b5]
- Updated dependencies [2c072c6]
- Updated dependencies [a79683f]
- Updated dependencies [115e213]
- Updated dependencies [e23e13a]
- Updated dependencies [1438b3d]
- Updated dependencies [9779aac]
- Updated dependencies [4f3077a]
- Updated dependencies [59a4a66]
- Updated dependencies [339e6d8]
- Updated dependencies [53ff215]
- Updated dependencies [7d47477]
- Updated dependencies [92a5de1]
- Updated dependencies [002d388]
- Updated dependencies [98b9031]
- Updated dependencies [6f8004c]
- Updated dependencies [59054fe]
- Updated dependencies [c265f0f]
- Updated dependencies [9850238]
- Updated dependencies [b8fcd1c]
- Updated dependencies [4c64373]
- Updated dependencies [0b8b150]
- Updated dependencies [8aadbbc]
- Updated dependencies [504224b]
- Updated dependencies [f2db0fa]
- Updated dependencies [5b33838]
- Updated dependencies [db072e3]
- Updated dependencies [cf9eb95]
- Updated dependencies [7fe4744]
- Updated dependencies [e7cb7a0]
- Updated dependencies [d85aeb5]
- Updated dependencies [8e84fcf]
- Updated dependencies [310f098]
- Updated dependencies [310f098]
- Updated dependencies [310f098]
- Updated dependencies [7654c59]
- Updated dependencies [4e8fa20]
- Updated dependencies [2f17c60]
  - @quill/shared@0.1.0
  - @quill/engine@0.1.0
  - @quill/types@0.1.0
