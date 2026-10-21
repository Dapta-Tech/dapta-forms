import { describe, expect, it } from 'vitest';
import {
  MCP_SERVER_NAME,
  claudeCodeCommand,
  codexConfigToml,
  cursorDeeplink,
  cursorMcpJson,
  mcpSnippets,
  publicMcpUrl,
} from './mcp-connect';

const URL_ = 'https://forms-api.example.com/mcp';

describe('publicMcpUrl', () => {
  it('prefers MCP_PUBLIC_URL, kept whole and without its trailing slash', () => {
    expect(publicMcpUrl({ MCP_PUBLIC_URL: 'https://mcp.example.com/mcp/', PUBLIC_API_URL: 'https://api.example.com' })).toBe(
      'https://mcp.example.com/mcp',
    );
  });

  it('falls back to /mcp on the public API address', () => {
    expect(publicMcpUrl({ PUBLIC_API_URL: 'https://api.example.com/forms-api/' })).toBe('https://api.example.com/forms-api/mcp');
    expect(publicMcpUrl({})).toBe('http://localhost:4000/mcp');
  });

  it('is null when no public address is usable, and ignores a malformed MCP_PUBLIC_URL', () => {
    expect(publicMcpUrl({ API_URL: 'http://forms-api.lab.svc.cluster.local' })).toBeNull();
    expect(publicMcpUrl({ MCP_PUBLIC_URL: 'not a url', PUBLIC_API_URL: 'https://api.example.com' })).toBe('https://api.example.com/mcp');
    expect(publicMcpUrl({ MCP_PUBLIC_URL: 'ftp://mcp.example.com', API_URL: 'http://api:4000' })).toBeNull();
  });

  it('never reads a build-time NEXT_PUBLIC_MCP variable', () => {
    expect(publicMcpUrl({ NEXT_PUBLIC_MCP_URL: 'https://baked.example.com/mcp', PUBLIC_API_URL: 'https://api.example.com' })).toBe(
      'https://api.example.com/mcp',
    );
  });
});

describe('snippets', () => {
  it('Claude Code: single-quoted header, so the shell keeps the variable for Claude Code to expand', () => {
    expect(claudeCodeCommand(URL_)).toBe(
      `claude mcp add --transport http dforms ${URL_} \\\n  --header 'Authorization: Bearer \${DFORMS_API_KEY}'`,
    );
  });

  it('Codex: the bearer comes from the named variable', () => {
    expect(codexConfigToml(URL_)).toBe(`[mcp_servers.dforms]\nurl = "${URL_}"\nbearer_token_env_var = "DFORMS_API_KEY"`);
  });

  it("Cursor: the entry uses Cursor's own env interpolation, in the file and in the one-click link", () => {
    const json = JSON.parse(cursorMcpJson(URL_)) as { mcpServers: Record<string, { url: string; headers: Record<string, string> }> };
    expect(json.mcpServers[MCP_SERVER_NAME]).toEqual({ url: URL_, headers: { Authorization: 'Bearer ${env:DFORMS_API_KEY}' } });
    const link = new URL(cursorDeeplink(URL_));
    expect(link.protocol).toBe('cursor:');
    expect(link.searchParams.get('name')).toBe('dforms');
    const config = JSON.parse(Buffer.from(link.searchParams.get('config')!, 'base64').toString('utf8'));
    expect(config).toEqual(json.mcpServers[MCP_SERVER_NAME]);
  });

  it('never carries a key, only the variable that holds it', () => {
    const all = JSON.stringify(mcpSnippets(URL_));
    expect(all).not.toMatch(/dforms_[A-Za-z0-9]/);
    expect(all).toContain('DFORMS_API_KEY');
  });
});
