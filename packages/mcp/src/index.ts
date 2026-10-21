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
export { McpDoor, hostnameOf, mcpCorsPolicy, type DoorContext, type DoorRequest, type DoorResponse, type McpDoorOptions } from './door';
export { unlimited, type RateLimiter } from './rate-limit';
export {
  CALL_KEY,
  FormsMcpServer,
  MCP_INSTRUCTIONS,
  MCP_SERVER_NAME,
  MCP_SERVER_VERSION,
  type FormsMcpServerOptions,
  type McpCall,
} from './server';
export { ToolFailure, argsHash, redactArgs, renderIssues, toFailure, untrusted } from './support';
export { METRIC_DEFINITIONS, TOOLS, type ToolContext, type ToolDef, type ToolResult } from './tools';
