/**
 * The API keys page as the server renders it: the keys the API returned (or
 * the error state when it could not answer), shown for the caller's role, and
 * a link to the API docs page, in the reader's language. The docs themselves
 * are not on this page any more.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { getMessages, type Locale } from '@quill/shared';

const me = vi.fn();
const listApiKeys = vi.fn();
const locale = vi.hoisted(() => ({ value: 'en' as Locale }));
const apiUrl = vi.hoisted(() => ({ value: 'https://api.forms.example.com' as string | null }));

vi.mock('@/lib/admin-api', () => ({
  adminApi: {
    me: (...a: unknown[]) => me(...a),
    listApiKeys: (...a: unknown[]) => listApiKeys(...a),
  },
  isAdminRole: (role: string) => role === 'owner' || role === 'admin',
}));
vi.mock('@/lib/locale', () => ({ getLocale: async () => locale.value }));
vi.mock('@/lib/developer-skill/public-api-url', () => ({ publicApiUrl: () => apiUrl.value }));
vi.mock('next/navigation', () => ({
  // Like the real one for what matters here: a redirect is rethrown, anything else is not.
  unstable_rethrow: (e: unknown) => {
    if ((e as { digest?: string } | null)?.digest === 'NEXT_REDIRECT') throw e;
  },
}));
vi.mock('../actions', () => ({
  createApiKeyAction: vi.fn(),
  revokeApiKeyAction: vi.fn(),
}));

import DevelopersPage from './page';

const caller = (role: 'owner' | 'admin' | 'member') => ({
  memberId: 'mem-me',
  role,
  displayName: 'Alex Rivera',
  email: 'alex@example.com',
  timezone: 'America/Bogota',
});

const keys = [
  {
    id: 'key-1',
    name: 'Claude Code',
    last4: 'k1k1',
    createdAt: Date.UTC(2026, 9, 1),
    lastUsedAt: null,
    createdBy: { memberId: 'mem-me', name: 'Alex Rivera', email: 'alex@example.com' },
  },
];

const render = async () => renderToStaticMarkup((await DevelopersPage()) as ReactElement);

describe('DevelopersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    locale.value = 'en';
    apiUrl.value = 'https://api.forms.example.com';
  });

  it('is titled after the rail section, MCP', async () => {
    me.mockResolvedValue(caller('member'));
    listApiKeys.mockResolvedValue({ keys });
    const html = await render();
    expect(html).toMatch(/<h1[^>]*>MCP<\/h1>/);
    expect(html).not.toContain('Developers');
  });

  it('lists the keys the API returned, without the Created by column for a member', async () => {
    me.mockResolvedValue(caller('member'));
    listApiKeys.mockResolvedValue({ keys });
    const html = await render();
    const m = getMessages('en').admin;
    expect(html).toContain(m.developers.title);
    expect(html).toContain('data-testid="api-key-row"');
    expect(html).not.toContain(m.developers.keys.colCreatedBy);
  });

  it('adds the Created by column for an owner', async () => {
    me.mockResolvedValue(caller('owner'));
    listApiKeys.mockResolvedValue({ keys });
    const html = await render();
    expect(html).toContain(getMessages('en').admin.developers.keys.colCreatedBy);
  });

  it('renders the error state when the keys cannot be read', async () => {
    me.mockResolvedValue(caller('member'));
    listApiKeys.mockRejectedValue(new Error('API down'));
    const html = await render();
    const m = getMessages('en').admin.developers.keys;
    expect(html).toContain(m.loadError);
    expect(html).not.toContain(m.emptyTitle);
  });

  it('lets a redirect from the key list escape instead of showing the error state', async () => {
    me.mockResolvedValue(caller('member'));
    const redirect = Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT' });
    listApiKeys.mockRejectedValue(redirect);
    await expect(render()).rejects.toBe(redirect);
  });

  it('links to the API docs instead of carrying them, in Spanish for a Spanish reader', async () => {
    locale.value = 'es';
    me.mockResolvedValue(caller('member'));
    listApiKeys.mockResolvedValue({ keys: [] });
    const html = await render();
    const es = getMessages('es').admin;
    const link = html.match(/<a [^>]*data-testid="api-docs-link"[^>]*>.*?<\/a>/)?.[0] ?? '';
    expect(link).toContain('href="/admin/developers/docs"');
    expect(link).toContain(es.chrome.developersMenu.docs);
    expect(html).toContain(es.developers.keys.emptyTitle);
    expect(html).not.toContain(es.developerDocs.title);
  });

  describe('setup guide', () => {
    const download = (html: string) =>
      html.match(/<a [^>]*data-testid="api-keys-skill-download"[^>]*>.*?<\/a>/)?.[0];

    it('opens the page with the three steps, the skill download first, above the keys', async () => {
      me.mockResolvedValue(caller('member'));
      listApiKeys.mockResolvedValue({ keys });
      const html = await render();
      const m = getMessages('en').admin;
      const link = download(html)!;
      expect(link).toContain('href="/api/developers/skill"');
      expect(link).toMatch(/\sdownload=""/);
      expect(link).toContain(m.developerDocs.skillButton);
      expect(html).toContain(m.developers.guide.title);
      expect(html).toContain(m.developers.guide.downloadTitle);
      // Download, key, agent, in that order, and all of it before the list.
      const at = (id: string) => html.indexOf(`data-testid="${id}"`);
      expect(at('setup-step-download')).toBeGreaterThan(-1);
      expect(at('setup-step-download')).toBeLessThan(at('setup-step-key'));
      expect(at('setup-step-key')).toBeLessThan(at('setup-step-agent'));
      expect(at('setup-guide')).toBeLessThan(at('api-keys'));
    });

    it('is there with no keys yet and when the list failed: it does not depend on them', async () => {
      me.mockResolvedValue(caller('member'));
      listApiKeys.mockResolvedValue({ keys: [] });
      expect(download(await render())).toBeDefined();
      listApiKeys.mockRejectedValue(new Error('API down'));
      expect(download(await render())).toBeDefined();
    });

    it('says it is unavailable instead of a button that would fail, without a public API address', async () => {
      apiUrl.value = null;
      me.mockResolvedValue(caller('member'));
      listApiKeys.mockResolvedValue({ keys });
      const html = await render();
      expect(download(html)).toBeUndefined();
      expect(html).toContain(getMessages('en').admin.developerDocs.skillUnavailable);
    });

    it('speaks Spanish to a Spanish reader', async () => {
      locale.value = 'es';
      me.mockResolvedValue(caller('member'));
      listApiKeys.mockResolvedValue({ keys });
      const html = await render();
      const es = getMessages('es').admin;
      expect(html).toContain(es.developers.guide.title);
      expect(download(html)).toContain(es.developerDocs.skillButton);
    });
  });
});
