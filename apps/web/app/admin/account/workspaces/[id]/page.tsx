import Link from 'next/link';
import { getMessages, t, type FormsMessages } from '@quill/shared';
import {
  adminApi,
  ApiError,
  isAdminRole,
  type AccountMember,
  type AccountRole,
  type Me,
  type PendingInvitation,
} from '@/lib/admin-api';
import { getLocale } from '@/lib/locale';
import { InviteMember } from './invite-member';
import { InvitationsTable } from './invitations-table';
import { MembersTable } from './members-table';
import { WorkspaceName } from './workspace-name';

export const dynamic = 'force-dynamic';

type Tab = 'members' | 'invitations';

/**
 * Account settings → Workspaces → one workspace: its name (renameable by
 * admins/owners), the Add-member entry point, and two tabs, Members and
 * Invitations. Everything here names the workspace by id (the
 * `x-quill-workspace` header) instead of the cookie, so any workspace the
 * caller belongs to is manageable WITHOUT switching into it. The API re-checks
 * membership + role on every call; a 403 on the override renders the
 * not-found panel rather than bouncing the person out of the workspace they
 * are actually in.
 */
export default async function WorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const tab: Tab = sp.tab === 'invitations' ? 'invitations' : 'members';
  const locale = await getLocale();
  const messages = getMessages(locale).admin;
  const a = messages.account;
  const w = a.workspace;
  const s = messages.settings;

  const workspaces = await adminApi.listWorkspaces().catch(() => []);
  const ws = workspaces.find((x) => x.accountId === id);
  if (!ws) return <NotFoundPanel a={a} />;

  // Who am I in THAT workspace (role can differ per workspace). A 403 means
  // "not yours to manage" and is rendered, never redirected; anything else
  // (API down) still surfaces to the error boundary.
  let me: Me;
  try {
    me = await adminApi.me({ workspace: id });
  } catch (e) {
    if (e instanceof ApiError && (e.status === 403 || e.status === 404)) return <NotFoundPanel a={a} />;
    throw e;
  }
  const canManage = isAdminRole(me.role);

  const [members, invitations]: [AccountMember[], PendingInvitation[]] = canManage
    ? await Promise.all([
        adminApi.listMembers({ workspace: id }).catch(() => []),
        adminApi.listInvitations({ workspace: id }).catch(() => []),
      ])
    : [[], []];

  const roleLabel: Record<AccountRole, string> = {
    owner: s.roleOwner,
    admin: s.roleAdmin,
    member: s.roleMember,
  };
  const memberText =
    ws.memberCount === 1
      ? a.workspaces.memberOne
      : t(a.workspaces.memberOther, { count: new Intl.NumberFormat(locale).format(ws.memberCount) });
  const pendingCount = invitations.length + members.filter((m) => m.status === 'invited').length;

  // The pending count rides on the Invitations tab so it is visible without
  // opening it; Members carries none (the meta line above already says how many).
  const tabs: { key: Tab; label: string; testId: string; count?: number }[] = [
    { key: 'members', label: w.tabMembers, testId: 'workspace-tab-members' },
    {
      key: 'invitations',
      label: w.tabInvitations,
      testId: 'workspace-tab-invitations',
      count: pendingCount > 0 ? pendingCount : undefined,
    },
  ];

  return (
    <div>
      <Link
        href="/admin/account/workspaces"
        data-testid="workspace-back"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <i aria-hidden className="pi pi-arrow-left" style={{ fontSize: 12 }} />
        {w.back}
      </Link>

      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <WorkspaceName
          accountId={id}
          initial={ws.accountName}
          canEdit={canManage}
          labels={{
            workspaceName: s.workspaceName,
            workspaceNameSave: s.workspaceNameSave,
            workspaceNameSaved: s.workspaceNameSaved,
            workspaceNameError: s.workspaceNameError,
          }}
        />
        {canManage ? (
          <InviteMember
            accountId={id}
            labels={{
              addMember: s.addMember,
              inviteTitle: s.inviteTitle,
              inviteSubtitle: s.inviteSubtitle,
              inviteEmailLabel: s.inviteEmailLabel,
              inviteEmailPlaceholder: s.inviteEmailPlaceholder,
              inviteRoleLabel: s.inviteRoleLabel,
              roleAdmin: s.roleAdmin,
              roleMember: s.roleMember,
              inviteSubmit: s.inviteSubmit,
              inviteCancel: s.inviteCancel,
              inviteSuccess: s.inviteSuccess,
              inviteErrorTaken: s.inviteErrorTaken,
              inviteErrorInvalid: s.inviteErrorInvalid,
              inviteErrorFailed: s.inviteErrorFailed,
              inviteErrorUpstream: s.inviteErrorUpstream,
            }}
          />
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="text-faint">{a.workspaces.yourRole}:</span>
          <span className="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-xs text-foreground">
            {roleLabel[me.role]}
          </span>
        </span>
        <span aria-hidden className="text-faint">
          ·
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i aria-hidden className="pi pi-users" style={{ fontSize: 13 }} />
          {memberText}
        </span>
        <span aria-hidden className="text-faint">
          ·
        </span>
        <span className="font-mono text-xs text-faint" title={ws.accountCode}>
          {ws.accountCode}
        </span>
      </div>

      {!canManage ? (
        <div className="mt-8 flex items-start gap-3 rounded-xl border border-dashed border-border bg-card/40 p-6 text-sm text-muted-foreground">
          <i aria-hidden className="pi pi-lock mt-0.5 shrink-0" style={{ fontSize: 14 }} />
          <p>{w.noAccess}</p>
        </div>
      ) : (
        <>
          <nav className="mt-6 flex items-center gap-1 border-b border-border" aria-label={ws.accountName}>
            {tabs.map((item) => {
              const isActive = item.key === tab;
              return (
                <Link
                  key={item.key}
                  href={`?tab=${item.key}`}
                  scroll={false}
                  data-testid={item.testId}
                  aria-current={isActive ? 'page' : undefined}
                  className={
                    isActive
                      ? 'relative -mb-px inline-flex items-center gap-2 border-b-2 border-primary-edge px-3 py-2 text-sm font-semibold text-foreground'
                      : 'relative -mb-px inline-flex items-center gap-2 border-b-2 border-transparent px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground'
                  }
                >
                  {item.label}
                  {item.count !== undefined ? (
                    <span className="rounded-full bg-muted px-1.5 py-0.5 text-2xs font-medium tabular-nums text-faint">
                      {item.count}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </nav>

          <div className="mt-6">
            {tab === 'members' ? (
              <MembersTable
                accountId={id}
                members={members}
                me={{ memberId: me.memberId, role: me.role }}
                labels={{
                  colName: w.colName,
                  colEmail: w.colEmail,
                  colRole: w.colRole,
                  colStatus: w.colStatus,
                  colActions: w.colActions,
                  you: s.you,
                  membersEmpty: s.membersEmpty,
                  roleOwner: s.roleOwner,
                  roleAdmin: s.roleAdmin,
                  roleMember: s.roleMember,
                  statusActive: s.statusActive,
                  statusInvited: s.statusInvited,
                  statusDisabled: s.statusDisabled,
                  actions: {
                    membersMenu: s.membersMenu,
                    makeAdmin: s.makeAdmin,
                    makeMember: s.makeMember,
                    activate: w.activate,
                    deactivate: w.deactivate,
                    removeMember: s.removeMember,
                    removeConfirm: s.removeConfirm,
                    roleChangeSuccess: s.roleChangeSuccess,
                    statusChangeSuccess: w.statusChangeSuccess,
                    removeSuccess: s.removeSuccess,
                    manageErrorLastOwner: s.manageErrorLastOwner,
                    manageErrorForbidden: s.manageErrorForbidden,
                    manageErrorFailed: s.manageErrorFailed,
                    manageErrorUpstream: s.manageErrorUpstream,
                    manageErrorOwnership: s.manageErrorOwnership,
                  },
                }}
              />
            ) : (
              <InvitationsTable
                accountId={id}
                invitations={invitations}
                invitedMembers={members.filter((m) => m.status === 'invited')}
                locale={locale}
                labels={{
                  invitationsSubtitle: w.invitationsSubtitle,
                  invitationsEmpty: w.invitationsEmpty,
                  colEmail: w.colEmail,
                  colStatus: w.colStatus,
                  colSent: w.colSent,
                  colExpires: w.colExpires,
                  colActions: w.colActions,
                  pendingBadge: s.pendingBadge,
                  resendInvite: s.resendInvite,
                  resendSuccess: s.resendSuccess,
                  resendError: s.resendError,
                }}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The workspace is not among the caller's memberships (a stale link, a
 * revoked membership, or an id that was never theirs), or the API refused the
 * override. A friendly panel with a way back; never a 404 page, because the
 * rest of Account settings is still theirs to use.
 */
function NotFoundPanel({ a }: { a: FormsMessages['admin']['account'] }) {
  return (
    <div data-testid="workspace-not-found">
      <Link
        href="/admin/account/workspaces"
        data-testid="workspace-back"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <i aria-hidden className="pi pi-arrow-left" style={{ fontSize: 12 }} />
        {a.workspace.back}
      </Link>
      <div className="mt-4 flex flex-col items-center gap-4 rounded-xl border border-dashed border-border bg-card/40 p-12 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <i aria-hidden className="pi pi-lock" style={{ fontSize: 20 }} />
        </div>
        <p className="text-sm text-muted-foreground">{a.workspace.notFound}</p>
      </div>
    </div>
  );
}
