/**
 * The old API keys address is in skill zips and bookmarks: it lands on the MCP
 * page, where the existing keys are listed under the connector guide.
 */
import { describe, expect, it, vi } from 'vitest';

const redirect = vi.hoisted(() =>
  vi.fn((to: string) => {
    throw Object.assign(new Error('NEXT_REDIRECT'), { digest: `NEXT_REDIRECT;replace;${to}` });
  }),
);
vi.mock('next/navigation', () => ({ redirect }));

import DeveloperKeysRedirect from './page';

describe('/admin/developers/keys', () => {
  it('redirects to the MCP connector guide', () => {
    expect(() => DeveloperKeysRedirect()).toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/admin/developers/connect');
  });
});
