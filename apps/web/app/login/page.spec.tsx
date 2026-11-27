/**
 * `/login` is where a signed-out visit to a dashboard page is sent (the admin
 * layout and the wizard redirect here on a 401). On a WorkOS build it goes
 * straight on to the hosted login, always on the SIGN-IN screen: only the app
 * root passes a landing's `?screen=sign-up` on (lib/login-screen.ts), and this
 * page never does, whatever its URL carries.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const provider = vi.fn(() => 'workos');
vi.mock('@/lib/auth-session', () => ({ authProvider: () => provider() }));
vi.mock('@/lib/locale', () => ({ getLocale: async () => 'en' }));
vi.mock('./login-form', () => ({ LoginForm: () => null }));
const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT ${url}`);
});
vi.mock('next/navigation', () => ({ redirect: (url: string) => redirect(url) }));

import LoginPage from './page';

const visit = (params: Record<string, string>) => LoginPage({ searchParams: Promise.resolve(params) });

describe('/login on a WorkOS build', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    provider.mockReturnValue('workos');
  });

  it('hands a signed-out dashboard visit to the hosted login, on the sign-in screen', async () => {
    await expect(visit({})).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/api/auth/login');
  });

  it('never passes a sign-up screen on, even when the URL carries one', async () => {
    await expect(visit({ screen: 'sign-up' })).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/api/auth/login');
    expect(String(redirect.mock.calls[0]?.[0])).not.toContain('screen');
  });
});

/** The signed-out landing's one button, where an expired session on a playbook ends up. */
describe('/login?signedout=1, the sign-in button', () => {
  const href = async (params: Record<string, string>) =>
    /href="(\/api\/auth\/login[^"]*)"/
      .exec(renderToStaticMarkup(await visit({ signedout: '1', ...params })))?.[1]
      ?.replace(/&amp;/g, '&');

  beforeEach(() => {
    vi.clearAllMocks();
    provider.mockReturnValue('workos');
  });

  it('asks the hosted login, as before', async () => {
    expect(await href({})).toBe('/api/auth/login?prompt=login');
  });

  it('brings the person back to the playbook they were on', async () => {
    const next = '/admin/playbooks/guia?lang=en&pdf=1';
    expect(await href({ next })).toBe(`/api/auth/login?prompt=login&next=${encodeURIComponent(next)}`);
  });

  it.each(['https://evil.example', '//evil.example', '/admin/forms', '/admin/playbooks/../../login', '"><script>'])(
    'drops %s',
    async (next) => {
      expect(await href({ next })).toBe('/api/auth/login?prompt=login');
    },
  );
});
