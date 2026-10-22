/**
 * `@quill/mcp`: the dForms MCP server, framework-free.
 *
 * - `FormsBackend` is the port a host implements (forms-api does, over its own
 *   handlers), so the tools inherit every rule a form write is held to.
 * - `FormsMcpServer` is the SDK's stateless Streamable HTTP handler with the
 *   tool catalog and the per-call wrapper (write rate limit, timeout, audit).
 * - `McpDoor` is the HTTP guard in front of it: method, Host, Origin, URL
 *   credentials, content type, authentication and rate limits.
 * - `@quill/mcp/guide` is the agent guide (config JSON Schema, rules,
 *   examples), shared with the web app's API skill.
 */
export * from './backend';
export * from './parity-backend';
export {
  LIST_WORKSPACES_HINT,
  SEARCH_FOLD_FROM,
  SEARCH_FOLD_TO,
  STAFF_SEARCH_MAX_RESULTS,
  STAFF_SEARCH_MIN_CHARS,
  STAFF_WORKSPACE_HINT,
  bucketOf,
  foldSearchText,
  normalizeWorkspaceSearch,
  openDFormsOnce,
  resolveWorkspace,
} from './workspace';
export {
  DoorRefusal,
  DoorThrottled,
  DoorUnavailable,
  McpDoor,
  clientInfoOf,
  hostnameOf,
  mcpCorsPolicy,
  type DoorContext,
  type DoorRequest,
  type DoorResponse,
  type McpDoorOAuth,
  type McpDoorOptions,
} from './door';
export { unlimited, type RateLimiter } from './rate-limit';
export {
  CALL_KEY,
  FormsMcpServer,
  MCP_INSTRUCTIONS,
  MCP_SERVER_NAME,
  MCP_SERVER_VERSION,
  type FormsMcpServerOptions,
  type McpCall,
  type McpClientInfo,
  type McpToolCallEvent,
} from './server';
export {
  ToolFailure,
  argsHash,
  describeError,
  redactArgs,
  renderIssues,
  toFailure,
  untrusted,
  type CredentialKind,
  type ErrorDescriptor,
} from './support';
export { METRIC_DEFINITIONS, TOOLS, type ToolContext, type ToolDef, type ToolResult } from './tools';
export { CATALOG } from './catalog';
export { API_ROUTE_EXCLUSIONS, API_ROUTE_TOOLS, PARITY_TOOLS } from './parity/index';
