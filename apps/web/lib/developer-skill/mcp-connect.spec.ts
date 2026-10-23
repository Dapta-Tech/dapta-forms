import { describe, expect, it } from 'vitest';
import {
  MCP_SERVER_NAME,
  claudeCodeCommand,
  claudeDirectoryUrl,
  codexAddCommand,
  codexLoginCommand,
  openclawLoginCommand,
  openclawSetCommand,
  cursorDeeplink,
  cursorMcpJson,
  mcpOauthEnabled,
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

describe('mcpOauthEnabled', () => {
  const PUBLIC = { MCP_PUBLIC_URL: 'https://mcp.example.com/mcp' };

  it('is on when the web mirrors the API adapter, whatever the case or the spaces', () => {
    expect(mcpOauthEnabled({ ...PUBLIC, MCP_OAUTH_PROVIDER: 'workos' })).toBe(true);
    expect(mcpOauthEnabled({ ...PUBLIC, MCP_OAUTH_PROVIDER: ' WorkOS ' })).toBe(true);
  });

  it('is off without MCP_PUBLIC_URL, the token audience the API requires: the address derived from the API would not match it', () => {
    expect(mcpOauthEnabled({ MCP_OAUTH_PROVIDER: 'workos' })).toBe(false);
    expect(mcpOauthEnabled({ MCP_OAUTH_PROVIDER: 'workos', MCP_PUBLIC_URL: '  ', PUBLIC_API_URL: 'https://api.example.com' })).toBe(false);
  });

  it('is off when unset or blank, the way a self-hosted install runs', () => {
    expect(mcpOauthEnabled({})).toBe(false);
    expect(mcpOauthEnabled({ MCP_OAUTH_PROVIDER: '' })).toBe(false);
    expect(mcpOauthEnabled({ MCP_OAUTH_PROVIDER: '   ' })).toBe(false);
  });

  it('fails closed on a value the API would not accept, so the page never offers a sign-in that cannot work', () => {
    expect(mcpOauthEnabled({ ...PUBLIC, MCP_OAUTH_PROVIDER: 'true' })).toBe(false);
    expect(mcpOauthEnabled({ ...PUBLIC, MCP_OAUTH_PROVIDER: 'workso' })).toBe(false);
  });

  it('never reads a build-time NEXT_PUBLIC_ variable', () => {
    expect(mcpOauthEnabled({ NEXT_PUBLIC_MCP_OAUTH_PROVIDER: 'workos' })).toBe(false);
  });
});

describe('claudeDirectoryUrl', () => {
  const LISTING = 'https://claude.ai/directory/dforms';

  it('is the listing as set, cleaned', () => {
    expect(claudeDirectoryUrl({ MCP_CLAUDE_DIRECTORY_URL: LISTING })).toBe(LISTING);
    expect(claudeDirectoryUrl({ MCP_CLAUDE_DIRECTORY_URL: ` ${LISTING}/?ref=x#top ` })).toBe(LISTING);
  });

  it('is null when unset, blank, not a URL or not https, on an address with no listing', () => {
    expect(claudeDirectoryUrl({})).toBeNull();
    expect(claudeDirectoryUrl({ MCP_CLAUDE_DIRECTORY_URL: '  ' })).toBeNull();
    expect(claudeDirectoryUrl({ MCP_CLAUDE_DIRECTORY_URL: 'dforms' })).toBeNull();
    expect(claudeDirectoryUrl({ MCP_CLAUDE_DIRECTORY_URL: 'http://claude.ai/directory/dforms' })).toBeNull();
  });

  it('never reads a build-time NEXT_PUBLIC_ variable', () => {
    expect(claudeDirectoryUrl({ NEXT_PUBLIC_MCP_CLAUDE_DIRECTORY_URL: LISTING })).toBeNull();
  });

  it('knows the dForms listing for the hosted MCP with no setting, and only for that address', () => {
    expect(claudeDirectoryUrl({ MCP_PUBLIC_URL: 'https://mcp.dforms.ai/mcp' })).toBe(LISTING);
    expect(claudeDirectoryUrl({ MCP_PUBLIC_URL: 'https://mcp.dforms.ai/mcp/' })).toBe(LISTING);
    expect(claudeDirectoryUrl({ MCP_PUBLIC_URL: 'https://mcp.dev.dforms.ai/mcp' })).toBeNull();
    expect(claudeDirectoryUrl({ MCP_PUBLIC_URL: 'https://mcp.forms.example.com/mcp' })).toBeNull();
  });

  it('lets a fork listed under its own address point at its own listing', () => {
    const own = 'https://claude.ai/directory/acme-forms';
    expect(claudeDirectoryUrl({ MCP_PUBLIC_URL: 'https://mcp.acme.example/mcp', MCP_CLAUDE_DIRECTORY_URL: own })).toBe(own);
  });

  it('rides along in the snippets, null by default', () => {
    expect(mcpSnippets(URL_).claudeDirectory).toBeNull();
    expect(mcpSnippets(URL_, LISTING).claudeDirectory).toBe(LISTING);
  });
});

describe('snippets', () => {
  it('Claude Code: added for every project by URL alone, the sign-in runs from /mcp', () => {
    expect(claudeCodeCommand(URL_)).toBe(`claude mcp add --transport http --scope user dforms ${URL_}`);
  });

  it('Codex: add by URL, then log in', () => {
    expect(codexAddCommand(URL_)).toBe(`codex mcp add dforms --url ${URL_}`);
    expect(codexLoginCommand).toBe('codex mcp login dforms');
  });

  it('OpenClaw: a remote streamable-HTTP entry that logs in with OAuth, then login', () => {
    expect(openclawSetCommand(URL_)).toBe(
      `openclaw mcp set dforms '{"url":"${URL_}","transport":"streamable-http","auth":"oauth"}'`,
    );
    expect(openclawLoginCommand).toBe('openclaw mcp login dforms');
  });

  it('Cursor: the entry is the URL alone, in the file and in the one-click link (base64 JSON, as on Dapta)', () => {
    const json = JSON.parse(cursorMcpJson(URL_)) as { mcpServers: Record<string, { url: string }> };
    expect(json.mcpServers[MCP_SERVER_NAME]).toEqual({ url: URL_ });
    const link = new URL(cursorDeeplink(URL_));
    expect(link.protocol).toBe('cursor:');
    expect(link.searchParams.get('name')).toBe('dforms');
    const config = JSON.parse(Buffer.from(link.searchParams.get('config')!, 'base64').toString('utf8'));
    expect(config).toEqual({ url: URL_ });
  });

  it('carries no key and no key variable: the app signs in instead', () => {
    const all = JSON.stringify(mcpSnippets(URL_));
    expect(all).not.toMatch(/dforms_[A-Za-z0-9]/);
    expect(all).not.toContain('DFORMS_API_KEY');
    expect(all).not.toMatch(/Authorization|bearer/i);
  });
});
