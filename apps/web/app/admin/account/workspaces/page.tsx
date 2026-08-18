import { getMessages } from '@quill/shared';
import { adminApi } from '@/lib/admin-api';
import { getLocale } from '@/lib/locale';
import { WorkspaceCards } from './workspace-cards';

export const dynamic = 'force-dynamic';

/**
 * Account settings → Workspaces: every workspace the caller belongs to, with
 * Open (enter it) and Manage (its members + invitations, no switching).
 */
export default async function WorkspacesPage() {
  const locale = await getLocale();
  const messages = getMessages(locale).admin;
  const a = messages.account.workspaces;
  const s = messages.settings;
  // Best-effort list: a failure renders the empty state instead of an error page.
  const [me, workspaces] = await Promise.all([adminApi.me(), adminApi.listWorkspaces().catch(() => [])]);

  return (
    <WorkspaceCards
      workspaces={workspaces}
      currentAccountId={me.accountId}
      locale={locale}
      labels={{
        title: a.title,
        subtitle: a.subtitle,
        search: a.search,
        searchEmpty: a.searchEmpty,
        newWorkspace: a.newWorkspace,
        current: a.current,
        invited: messages.chrome.workspaces.invited,
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
        createDialog: messages.chrome.workspaces,
      }}
    />
  );
}
