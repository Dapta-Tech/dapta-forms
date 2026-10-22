/**
 * `/admin/developers` is a door, not a page: the address lives in skill zips
 * people already downloaded, and it lands them on the connector guide.
 */
import { describe, expect, it, vi } from 'vitest';

const redirect = vi.hoisted(() =>
  vi.fn((to: string) => {
    throw Object.assign(new Error('NEXT_REDIRECT'), { digest: `NEXT_REDIRECT;replace;${to}` });
  }),
);
vi.mock('next/navigation', () => ({ redirect }));

import DevelopersIndex from './page';

describe('/admin/developers', () => {
  it('redirects to the connector guide', () => {
    expect(() => DevelopersIndex()).toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/admin/developers/connect');
  });
});

describe('next.config redirects', () => {
  it('answers /admin/developers and the old keys page with temporary HTTP redirects to the guide', async () => {
    const { default: config } = await import('../../../next.config.mjs');
    const rules = await config.redirects!();
    for (const source of ['/admin/developers', '/admin/developers/keys']) {
      expect(rules).toContainEqual({ source, destination: '/admin/developers/connect', permanent: false });
    }
    for (const source of ['/admin/developers/docs', '/admin/developers/docs/:path*']) {
      expect(rules).toContainEqual({ source, destination: '/admin/developers/tools', permanent: false });
    }
  });
});
