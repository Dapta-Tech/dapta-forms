/**
 * Where an agent connects to the dForms MCP server, and the snippet each agent
 * needs to do it, for the setup guide on the API keys page.
 *
 * The address is read at RUNTIME from the server's environment, never from a
 * `NEXT_PUBLIC_*` variable: Next inlines those at build time and one image
 * serves every environment, so a baked address would point one of them at the
 * other. The page that calls this renders per request.
 *
 *   MCP_PUBLIC_URL  the full MCP endpoint a customer reaches (a dedicated MCP
 *                   host, say). Trusted as set, like PUBLIC_API_URL.
 *   otherwise       `<public API address>/mcp` (see `publicApiUrl`), where the
 *                   API serves it.
 *
 * Null when neither is usable: the guide then says so instead of printing an
 * address nobody can reach.
 *
 * KEY HANDLING. No snippet ever contains a key. Each one names the environment
 * variable the agent reads it from at connect time, so a link, a pasted
 * command or a committed config file cannot leak a credential.
 */
import { API_KEY_ENV } from './agent-setup';
import { publicApiUrl } from './public-api-url';
import { cleanPublicUrl } from './public-url';

/** The name the server is registered under in each agent's config. */
export const MCP_SERVER_NAME = 'dforms';

export function publicMcpUrl(env: Record<string, string | undefined> = process.env): string | null {
  const explicit = cleanPublicUrl(env.MCP_PUBLIC_URL);
  if (explicit) return explicit;
  const api = publicApiUrl(env);
  return api ? `${api}/mcp` : null;
}

/** The single entry Cursor stores under `mcpServers.dforms`. */
export function cursorServerEntry(mcpUrl: string): { url: string; headers: { Authorization: string } } {
  // `${env:NAME}` is Cursor's own interpolation, resolved on the user's machine
  // when the server starts: the entry carries the variable's NAME, never its value.
  return { url: mcpUrl, headers: { Authorization: `Bearer \${env:${API_KEY_ENV}}` } };
}

/** The one-click install link. Cursor asks the user to confirm; it never installs on its own. */
export function cursorDeeplink(mcpUrl: string): string {
  const config = Buffer.from(JSON.stringify(cursorServerEntry(mcpUrl)), 'utf8').toString('base64');
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=${MCP_SERVER_NAME}&config=${encodeURIComponent(config)}`;
}

/** `.cursor/mcp.json` in a project, or `~/.cursor/mcp.json` for every project. */
export function cursorMcpJson(mcpUrl: string): string {
  return JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: cursorServerEntry(mcpUrl) } }, null, 2);
}

export function claudeCodeCommand(mcpUrl: string): string {
  return [
    `claude mcp add --transport http ${MCP_SERVER_NAME} ${mcpUrl} \\`,
    // Single quotes on purpose: the shell must NOT expand the variable, or Claude
    // Code would store the plaintext key in its config. It stores the literal
    // `${VAR}` and expands it each time it connects.
    `  --header 'Authorization: Bearer \${${API_KEY_ENV}}'`,
  ].join('\n');
}

/** `~/.codex/config.toml`: Codex reads the bearer token from the named variable. */
export function codexConfigToml(mcpUrl: string): string {
  return [`[mcp_servers.${MCP_SERVER_NAME}]`, `url = "${mcpUrl}"`, `bearer_token_env_var = "${API_KEY_ENV}"`].join('\n');
}

/** Everything the guide prints for one address, built on the server. */
export interface McpSnippets {
  url: string;
  claudeCode: string;
  codexToml: string;
  cursorDeeplink: string;
  cursorJson: string;
}

export function mcpSnippets(mcpUrl: string): McpSnippets {
  return {
    url: mcpUrl,
    claudeCode: claudeCodeCommand(mcpUrl),
    codexToml: codexConfigToml(mcpUrl),
    cursorDeeplink: cursorDeeplink(mcpUrl),
    cursorJson: cursorMcpJson(mcpUrl),
  };
}
