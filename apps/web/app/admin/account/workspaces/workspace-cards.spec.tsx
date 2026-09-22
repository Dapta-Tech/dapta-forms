/**
 * Account settings > Workspaces: the search box carries the branded clear
 * button (the browser's own is hidden app-wide). The query lives in component
 * state and static markup cannot type, so `useState('')` is seeded through a
 * thin wrapper around React's hook: the only empty-string state here is the
 * query.
 */
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
vi.mock('@/components/toast', () => ({
  useToast: () => ({ success: () => {}, error: () => {}, info: () => {} }),
}));

import { WorkspaceCards, type WorkspaceCardsLabels } from './workspace-cards';

function render(locale: 'en' | 'es') {
  const m = getMessages(locale).admin;
  const a = m.account.workspaces;
  const s = m.settings;
  const labels: WorkspaceCardsLabels = {
    title: a.title,
    subtitle: a.subtitle,
    search: a.search,
    searchClear: a.searchClear,
    searchEmpty: a.searchEmpty,
    newWorkspace: a.newWorkspace,
    current: a.current,
    invited: m.chrome.workspaces.invited,
    open: a.open,
    manage: a.manage,
    yourRole: a.yourRole,
    memberOne: a.memberOne,
    memberOther: a.memberOther,
    empty: a.empty,
    roleOwner: s.roleOwner,
    roleAdmin: s.roleAdmin,
    roleMember: s.roleMember,
    openErrorForbidden: s.manageErrorForbidden,
    openErrorFailed: s.manageErrorFailed,
    createDialog: m.chrome.workspaces,
  };
  return renderToStaticMarkup(
    <WorkspaceCards
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
      locale={locale}
      labels={labels}
    />,
  );
}

describe('WorkspaceCards search clear button', () => {
  beforeEach(() => {
    seed.query = '';
  });

  it('is absent while the search is empty', () => {
    const html = render('en');
    expect(html).toContain('data-testid="workspace-search"');
    expect(html).toContain('type="search"');
    expect(html).not.toContain('data-testid="workspace-search-clear"');
  });

  it('shows with a query, labelled from the catalog in en and es', () => {
    seed.query = 'ac';
    const en = render('en');
    expect(en).toContain('data-testid="workspace-search-clear"');
    expect(en).toContain('aria-label="Clear search"');
    expect(render('es')).toContain('aria-label="Limpiar búsqueda"');
  });
});
