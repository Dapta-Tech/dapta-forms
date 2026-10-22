import { describe, expect, it, vi } from 'vitest';

const redirect = vi.hoisted(() =>
  vi.fn((to: string) => {
    throw Object.assign(new Error('NEXT_REDIRECT'), { digest: `NEXT_REDIRECT;replace;${to}` });
  }),
);
vi.mock('next/navigation', () => ({ redirect }));

import DeveloperDocsRedirect from './page';

describe('/admin/developers/docs', () => {
  it('lands on Tools, which took the API docs page’s place', () => {
    expect(() => DeveloperDocsRedirect()).toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/admin/developers/tools');
  });
});
