/**
 * The rail's workspace switcher: its type-to-find box carries the branded
 * clear button (the browser's own is hidden app-wide). The menu is a portal
 * that only mounts in a browser, so it is swapped for an inline shell here,
 * and the query is seeded through a thin wrapper around React's `useState`
 * (the only empty-string state in the switcher is the query).
 */
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { getMessages } from '@quill/shared';

const seed = vi.hoisted(() => ({ query: '' }));

vi.mock('react', async (importOriginal) => {
  const react = await importOriginal<typeof import('react')>();
  return {
    ...react,
    useState: (init: unknown) => react.useState(init === '' ? seed.query : init),
  };
});
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));
vi.mock('@/components/ui/anchored-menu', () => ({
  AnchoredMenu: ({ children }: { children: ReactNode }) => <div data-menu>{children}</div>,
}));

import { WorkspaceSwitcher } from './workspace-switcher';

function render(locale: 'en' | 'es') {
  return renderToStaticMarkup(
    <WorkspaceSwitcher
      workspaces={[
        {
          accountId: 'acc-1',
          workspaceId: null,
          accountCode: 'acme',
          accountName: 'Acme',
          memberId: 'm-1',
          role: 'owner',
          status: 'active',
          memberCount: 1,
          accessGrant: null,
        },
      ]}
      currentAccountId="acc-1"
      staff
      m={getMessages(locale).admin.chrome.workspaces}
    />,
  );
}

describe('WorkspaceSwitcher search clear button', () => {
  beforeEach(() => {
    seed.query = '';
  });

  it('is absent while the search is empty', () => {
    const html = render('en');
    expect(html).toContain('data-testid="workspace-search-input"');
    expect(html).toContain('type="search"');
    expect(html).not.toContain('data-testid="workspace-switcher-clear"');
  });

  it('shows with a query, labelled from the catalog in en and es', () => {
    seed.query = 'ac';
    const en = render('en');
    expect(en).toContain('data-testid="workspace-switcher-clear"');
    expect(en).toContain('aria-label="Clear search"');
    expect(render('es')).toContain('aria-label="Limpiar búsqueda"');
  });

  it('is not a menu item, so the arrow keys skip it', () => {
    seed.query = 'ac';
    const html = render('en');
    const button = html.match(/<button[^>]*data-testid="workspace-switcher-clear"[^>]*>/)?.[0] ?? '';
    expect(button).not.toBe('');
    expect(button).not.toContain('role="menuitem"');
  });
});
