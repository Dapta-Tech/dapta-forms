import type { AccountMember, AccountRole, MemberStatus } from '@/lib/admin-api';
import { MemberRowActions, type MemberRowActionsLabels } from './member-row-actions';

export interface MembersTableLabels {
  colName: string;
  colEmail: string;
  colRole: string;
  colStatus: string;
  colActions: string;
  you: string;
  membersEmpty: string;
  roleOwner: string;
  roleAdmin: string;
  roleMember: string;
  statusActive: string;
  statusInvited: string;
  statusDisabled: string;
  actions: MemberRowActionsLabels;
}

/**
 * The workspace roster as a table (server-rendered; only the per-row kebab is a
 * client component). The API is the real gate (assertAdmin + assertCanManageTarget
 * + assertNotSelf); the row mirrors it so controls only render when they would
 * succeed: never for yourself, and an admin may not manage an owner (only an
 * owner can). Removal is owner-only on top of that.
 */
export function MembersTable({
  accountId,
  members,
  me,
  labels,
}: {
  accountId: string;
  members: AccountMember[];
  /** The caller, as seen from THIS workspace (role may differ per workspace). */
  me: { memberId: string; role: AccountRole };
  labels: MembersTableLabels;
}) {
  const roleLabel: Record<AccountRole, string> = {
    owner: labels.roleOwner,
    admin: labels.roleAdmin,
    member: labels.roleMember,
  };
  const statusLabel: Record<MemberStatus, string> = {
    active: labels.statusActive,
    invited: labels.statusInvited,
    disabled: labels.statusDisabled,
  };

  if (members.length === 0) {
    return (
      <p
        data-testid="members-table"
        className="rounded-xl border border-dashed border-border bg-card/40 p-8 text-center text-sm text-muted-foreground"
      >
        {labels.membersEmpty}
      </p>
    );
  }

  return (
    // The horizontal scroll lives INSIDE this container; the page never scrolls sideways.
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full min-w-[640px] border-collapse text-sm" data-testid="members-table">
        <thead>
          <tr className="border-b border-border text-left text-2xs uppercase tracking-wide text-faint">
            <th className="whitespace-nowrap px-4 py-3 font-medium">{labels.colName}</th>
            <th className="whitespace-nowrap px-4 py-3 font-medium">{labels.colEmail}</th>
            <th className="whitespace-nowrap px-4 py-3 font-medium">{labels.colRole}</th>
            <th className="whitespace-nowrap px-4 py-3 font-medium">{labels.colStatus}</th>
            <th className="whitespace-nowrap px-4 py-3 text-right font-medium">
              <span className="sr-only">{labels.colActions}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {members.map((mem) => {
            const isYou = mem.id === me.memberId;
            const canManageRow = !isYou && (me.role === 'owner' || mem.role !== 'owner');
            const initial = (mem.displayName?.trim()?.charAt(0) || mem.email?.charAt(0) || '?').toUpperCase();
            const name = mem.displayName?.trim() || mem.email || '';
            return (
              <tr
                key={mem.id}
                data-testid="member-row"
                data-member-id={mem.id}
                className="border-b border-border last:border-b-0"
              >
                <td className="px-4 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-background text-xs font-semibold text-muted-foreground">
                      {initial}
                    </span>
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-medium text-foreground" title={name}>
                        {name}
                      </span>
                      {isYou ? (
                        <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-2xs font-medium uppercase tracking-wide text-faint">
                          {labels.you}
                        </span>
                      ) : null}
                    </span>
                  </div>
                </td>
                <td className="max-w-[260px] truncate px-4 py-3 text-muted-foreground" title={mem.email ?? undefined}>
                  {mem.email ?? ''}
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <span className="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
                    {roleLabel[mem.role]}
                  </span>
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <StatusBadge status={mem.status} label={statusLabel[mem.status]} />
                </td>
                <td className="whitespace-nowrap px-4 py-2 text-right">
                  {canManageRow ? (
                    <MemberRowActions
                      accountId={accountId}
                      memberId={mem.id}
                      role={mem.role}
                      status={mem.status}
                      // Removal is owner-only for an accepted membership; an `invited`
                    // row is an invitation, and retracting one is any admin's call
                    // (the API applies the same rule on both of its paths).
                    canRemove={me.role === 'owner' || mem.status === 'invited'}
                      labels={labels.actions}
                    />
                  ) : (
                    <span aria-hidden className="inline-block h-9 w-9" />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Active / Invited / Disabled as a dot + label chip (same grammar as the submissions badges). */
export function StatusBadge({ status, label }: { status: MemberStatus; label: string }) {
  const tone =
    status === 'active'
      ? { chip: 'bg-primary/20 text-foreground', dot: 'bg-primary-edge' }
      : status === 'invited'
        ? { chip: 'bg-secondary/20 text-foreground', dot: 'bg-secondary' }
        : { chip: 'bg-muted text-muted-foreground', dot: 'bg-faint' };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${tone.chip}`}>
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
      {label}
    </span>
  );
}
