import { describe, expect, it } from 'vitest';
import { corsOrigins, isMcpPath } from './cors';

describe('corsOrigins', () => {
  it('is the explicit list when CORS_ORIGINS is set', () => {
    expect(corsOrigins({ CORS_ORIGINS: 'https://a.example, https://b.example ,', PUBLIC_APP_URL: 'https://app.example' })).toEqual([
      'https://a.example',
      'https://b.example',
    ]);
  });

  it("falls back to the app's own origin, then the local web app", () => {
    expect(corsOrigins({ CORS_ORIGINS: undefined, PUBLIC_APP_URL: 'https://app.example' })).toEqual(['https://app.example']);
    expect(corsOrigins({ CORS_ORIGINS: '', PUBLIC_APP_URL: '' })).toEqual(['http://localhost:3000']);
  });
});

describe('isMcpPath', () => {
  it('matches the MCP endpoint only', () => {
    expect(isMcpPath('/mcp')).toBe(true);
    expect(isMcpPath('/mcp/')).toBe(true);
    expect(isMcpPath('/mcp?x=1')).toBe(true);
    expect(isMcpPath('/mcpx')).toBe(false);
    expect(isMcpPath('/v1/mcp')).toBe(false);
    expect(isMcpPath(undefined)).toBe(false);
  });
});
