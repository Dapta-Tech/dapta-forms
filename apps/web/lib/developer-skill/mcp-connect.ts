/**
 * Where an AI app connects to the dForms MCP server, and the snippet each app
 * needs to do it, for the connector guide on the MCP page.
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
 * NO KEY. Every snippet connects with the URL alone: the app signs in with
 * the person's account (OAuth) the first time it calls the server, so a
 * link, a pasted command or a committed config file carries no credential.
 */
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

/**
 * The sign-in adapters the API's MCP door knows (its `MCP_OAUTH_PROVIDER`).
 * The web mirrors that variable, the way it mirrors `AUTH_PROVIDER`.
 */
const MCP_OAUTH_PROVIDERS = ['workos'] as const;

/**
 * Whether this deployment's MCP server takes a sign-in (OAuth) besides the API
 * key, so a chat client (Claude.ai, ChatGPT) can connect with the URL alone.
 *
 * Read at RUNTIME from `MCP_OAUTH_PROVIDER`, the same name and values as the
 * API's, so one value per environment drives both. Unset or blank is the
 * self-hosted default: the page shows the key guide alone, exactly as before.
 * A value the API would not accept fails closed for the same reason: the page
 * never offers a sign-in that cannot work.
 *
 * It also needs `MCP_PUBLIC_URL`, which the API requires with the provider on
 * and checks every token's audience against. Without it the page would show
 * the address it derives from the public API (`publicMcpUrl`), a URL whose
 * tokens the API would refuse, so the chat path stays off instead.
 */
export function mcpOauthEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const value = env.MCP_OAUTH_PROVIDER?.trim().toLowerCase();
  if (!value || !(MCP_OAUTH_PROVIDERS as readonly string[]).includes(value)) return false;
  return cleanPublicUrl(env.MCP_PUBLIC_URL) !== null;
}

/**
 * The connector listings in Claude's directory, by the MCP address each one
 * connects to. dForms is listed for its hosted MCP only, so its own
 * deployment shows the listing with no setting, while a dev or self-hosted
 * deployment (another address) never sends people to someone else's server.
 */
const CLAUDE_DIRECTORY_LISTINGS: Record<string, string> = {
  'https://mcp.dforms.ai/mcp': 'https://claude.ai/directory/dforms',
};

/**
 * The connector's page in Claude's directory for this deployment's MCP, or
 * null. Read at RUNTIME: `MCP_CLAUDE_DIRECTORY_URL` (https only) for a fork
 * listed under its own address; otherwise the listing known for
 * `MCP_PUBLIC_URL`. Null and the guide keeps the custom connector as
 * Claude's only path.
 */
export function claudeDirectoryUrl(env: Record<string, string | undefined> = process.env): string | null {
  const explicit = cleanPublicUrl(env.MCP_CLAUDE_DIRECTORY_URL);
  if (explicit?.startsWith('https://')) return explicit;
  const mcp = cleanPublicUrl(env.MCP_PUBLIC_URL);
  return (mcp && CLAUDE_DIRECTORY_LISTINGS[mcp]) ?? null;
}

/** The single entry Cursor stores under `mcpServers.dforms`: the URL alone, Cursor runs the sign-in. */
export function cursorServerEntry(mcpUrl: string): { url: string } {
  return { url: mcpUrl };
}

/**
 * The one-click install link, the same encoding as Dapta's own MCP page: the
 * entry as base64 JSON. Cursor asks the user to confirm; it never installs on
 * its own.
 */
export function cursorDeeplink(mcpUrl: string): string {
  const config = Buffer.from(JSON.stringify(cursorServerEntry(mcpUrl)), 'utf8').toString('base64');
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=${MCP_SERVER_NAME}&config=${encodeURIComponent(config)}`;
}

/** `~/.cursor/mcp.json` (every project) or `.cursor/mcp.json` (one project). */
export function cursorMcpJson(mcpUrl: string): string {
  return JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: cursorServerEntry(mcpUrl) } }, null, 2);
}

/** Claude Code, for every project of this user; `/mcp` then runs the sign-in. */
export function claudeCodeCommand(mcpUrl: string): string {
  return `claude mcp add --transport http --scope user ${MCP_SERVER_NAME} ${mcpUrl}`;
}

/** Codex: add the server by URL, then `codexLoginCommand` runs the sign-in. */
export function codexAddCommand(mcpUrl: string): string {
  return `codex mcp add ${MCP_SERVER_NAME} --url ${mcpUrl}`;
}

export const codexLoginCommand = `codex mcp login ${MCP_SERVER_NAME}`;

/**
 * OpenClaw: save the server as a remote, streamable-HTTP entry that logs in
 * with OAuth (`mcp.servers.dforms` in its config), per OpenClaw's
 * `openclaw mcp set` docs; `openclawLoginCommand` then runs the sign-in.
 */
export function openclawSetCommand(mcpUrl: string): string {
  const entry = JSON.stringify({ url: mcpUrl, transport: 'streamable-http', auth: 'oauth' });
  return `openclaw mcp set ${MCP_SERVER_NAME} '${entry}'`;
}

export const openclawLoginCommand = `openclaw mcp login ${MCP_SERVER_NAME}`;

/**
 * Hermes (Nous Research): an `mcp_servers` entry in `~/.hermes/config.yaml`
 * with `auth: oauth`, per Hermes' MCP docs; `hermesLoginCommand` then runs
 * the sign-in in the browser.
 */
export function hermesConfig(mcpUrl: string): string {
  return `mcp_servers:\n  ${MCP_SERVER_NAME}:\n    url: "${mcpUrl}"\n    auth: oauth`;
}

export const hermesLoginCommand = `hermes mcp login ${MCP_SERVER_NAME}`;

/** Everything the guide prints for one address, built on the server. */
export interface McpSnippets {
  url: string;
  /** dForms' listing in Claude's directory, or null where it does not apply (`claudeDirectoryUrl`). */
  claudeDirectory: string | null;
  claudeCode: string;
  codexAdd: string;
  codexLogin: string;
  openclawSet: string;
  openclawLogin: string;
  hermesConfig: string;
  hermesLogin: string;
  cursorDeeplink: string;
  cursorJson: string;
}

export function mcpSnippets(mcpUrl: string, claudeDirectory: string | null = null): McpSnippets {
  return {
    url: mcpUrl,
    claudeDirectory,
    claudeCode: claudeCodeCommand(mcpUrl),
    codexAdd: codexAddCommand(mcpUrl),
    codexLogin: codexLoginCommand,
    openclawSet: openclawSetCommand(mcpUrl),
    openclawLogin: openclawLoginCommand,
    hermesConfig: hermesConfig(mcpUrl),
    hermesLogin: hermesLoginCommand,
    cursorDeeplink: cursorDeeplink(mcpUrl),
    cursorJson: cursorMcpJson(mcpUrl),
  };
}
