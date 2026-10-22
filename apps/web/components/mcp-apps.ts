/**
 * The AI apps dForms connects to, in the connect page's tab order, with their
 * names. Plain data with no client directive, so a server component (the home
 * banner) can read it; `mcp-logos.tsx` re-exports it for client code.
 */
export const MCP_APPS = ['claude', 'chatgpt', 'claude-code', 'codex', 'cursor', 'openclaw', 'hermes'] as const;
export type McpApp = (typeof MCP_APPS)[number];

/** Each app's own name, the same in every language. */
export const MCP_APP_NAMES: Record<McpApp, string> = {
  chatgpt: 'ChatGPT',
  claude: 'Claude',
  'claude-code': 'Claude Code',
  cursor: 'Cursor',
  codex: 'Codex',
  openclaw: 'OpenClaw',
  hermes: 'Hermes',
};
