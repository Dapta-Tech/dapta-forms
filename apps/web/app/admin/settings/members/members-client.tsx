'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import type { BookingMessages } from '@slate/shared';
import type { AccountMember, AccountRole, MemberStatus } from '@/lib/admin-api';
import { useToast } from '@/components/toast';
import {
  inviteMemberAction,
  removeMemberAction,
  setMemberRoleAction,
  setMemberStatusAction,
} from './actions';

type Messages = BookingMessages['admin']['members'];

const initialOf = (m: AccountMember) =>
  (m.displayName?.trim()?.[0] ?? m.email?.trim()?.[0] ?? '?').toUpperCase();

const roleLabel = (m: Messages, role: AccountRole) =>
  role === 'owner' ? m.roleOwner : role === 'admin' ? m.roleAdmin : m.roleMember;

const statusLabel = (m: Messages, s: MemberStatus) =>
  s === 'invited' ? m.statusInvited : s === 'disabled' ? m.statusDisabled : m.statusActive;

export function MembersClient({
  members,
  callerId,
  callerRole,
  messages: m,
}: {
  members: AccountMember[];
  callerId: string;
  callerRole: AccountRole;
  messages: Messages;
}) {
  const [pending, start] = useTransition();
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'member'>('member');
  const [inviteErr, setInviteErr] = useState<string | null>(null);
  const { success, error } = useToast();
  const triggerRef = useRef<HTMLButtonElement>(null);

  const isOwnerCaller = callerRole === 'owner';
  const activeOwners = members.filter((x) => x.role === 'owner' && x.status === 'active').length;

  const closeDialog = () => {
    setAddOpen(false);
    triggerRef.current?.focus();
  };
  useEffect(() => {
    if (!addOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeDialog();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [addOpen]);

  const run = (p: Promise<{ ok: boolean; message?: string }>, ok: string) =>
    start(async () => {
      const r = await p;
      if (r.ok) {
        success(ok);
        setConfirmRemove(null);
      } else {
        error(r.message ?? m.genericError);
      }
    });

  const submitInvite = () =>
    start(async () => {
      setInviteErr(null);
      const r = await inviteMemberAction(inviteEmail, inviteRole);
      if (r.ok) {
        success(m.memberInvited);
        setInviteEmail('');
        setInviteRole('member');
        closeDialog();
        return;
      }
      setInviteErr(
        r.code === 'INVALID_EMAIL'
          ? m.emailInvalid
          : r.code === 'EMAIL_TAKEN'
            ? m.emailTaken
            : (r.message ?? m.genericError),
      );
    });

  return (
    <div className="flex flex-col gap-4">
      {/* List/create pattern: the roster with the primary action top-right. */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-muted-foreground">{m.rosterLabel}</span>
        <button
          ref={triggerRef}
          type="button"
          onClick={() => {
            setInviteErr(null);
            setAddOpen(true);
          }}
          className="inline-flex min-h-[44px] items-center rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.98]"
        >
          {m.invite}
        </button>
      </div>

      <ul className="flex flex-col divide-y divide-border rounded-md border border-border bg-card">
        {members.map((member) => {
          const isSelf = member.id === callerId;
          const isOwner = member.role === 'owner';
          const isLastOwner = isOwner && activeOwners <= 1;
          // Admins may not act on owners; only an owner can. Never act on yourself
          // here (you can't lock yourself out of your own workspace).
          const canManage = !isSelf && (isOwnerCaller || !isOwner);
          const lockRole = !canManage || isLastOwner;
          // Owners are removed by demoting first (mirrors the team owner-lock).
          const canRemove = canManage && !isOwner;
          const canToggleStatus = canManage && !isOwner;

          return (
            <li key={member.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span
                aria-hidden
                className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-background bg-cover bg-center text-xs font-semibold text-muted-foreground"
                style={member.avatarUrl ? { backgroundImage: `url(${JSON.stringify(member.avatarUrl)})` } : undefined}
              >
                {member.avatarUrl ? '' : initialOf(member)}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-center gap-2 truncate text-sm font-medium">
                  {member.displayName ?? member.email ?? member.id.slice(0, 8)}
                  {isSelf ? (
                    <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                      {m.you}
                    </span>
                  ) : null}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {member.email ?? m.noEmail}
                </span>
              </span>

              {/* Status pill (invited / disabled stand out; active is quiet). */}
              <span
                className={`rounded-sm px-2 py-0.5 text-xs font-medium ${
                  member.status === 'invited'
                    ? 'bg-primary/10 text-primary'
                    : member.status === 'disabled'
                      ? 'bg-destructive/10 text-destructive'
                      : 'bg-muted text-muted-foreground'
                }`}
              >
                {statusLabel(m, member.status)}
              </span>

              {/* Role pill + inline change select (owner-only options gated). */}
              <span
                className={`rounded-sm px-2 py-0.5 text-xs font-medium ${
                  isOwner ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                }`}
              >
                {roleLabel(m, member.role)}
              </span>
              <select
                value={member.role}
                disabled={pending || lockRole}
                title={isLastOwner ? m.lastOwnerTitle : undefined}
                aria-label={`${m.roleLabel} · ${member.displayName ?? member.email ?? ''}`}
                onChange={(e) => run(setMemberRoleAction(member.id, e.target.value as AccountRole), m.roleUpdated)}
                className="min-h-[44px] rounded-md border border-input bg-background px-2 py-2 text-sm disabled:opacity-60"
              >
                <option value="member">{m.roleMember}</option>
                <option value="admin">{m.roleAdmin}</option>
                {/* Ownership is owner-granted only; keep the current owner value selectable. */}
                {isOwnerCaller || isOwner ? <option value="owner">{m.roleOwner}</option> : null}
              </select>

              {/* Enable / disable (soft access revocation). */}
              {canToggleStatus ? (
                member.status === 'disabled' ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(setMemberStatusAction(member.id, 'active'), m.statusUpdated)}
                    className="inline-flex min-h-[44px] items-center rounded-md border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
                  >
                    {m.enable}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(setMemberStatusAction(member.id, 'disabled'), m.statusUpdated)}
                    className="inline-flex min-h-[44px] items-center rounded-md border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-destructive hover:text-destructive disabled:opacity-60"
                  >
                    {m.disable}
                  </button>
                )
              ) : null}

              {/* Remove — owners show a lock (demote first); members get a confirm. */}
              {isOwner ? (
                <span className="flex items-center gap-1 text-xs text-muted-foreground" title={m.ownerLock}>
                  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} aria-hidden>
                    <rect x="5" y="11" width="14" height="9" rx="2" />
                    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
                  </svg>
                  <span className="sr-only">{m.ownerLock}</span>
                </span>
              ) : canRemove ? (
                confirmRemove === member.id ? (
                  <span className="flex items-center gap-1 text-sm">
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => run(removeMemberAction(member.id), m.memberRemoved)}
                      className="inline-flex min-h-[44px] items-center rounded-md border border-destructive px-3 py-2 text-destructive disabled:opacity-60"
                    >
                      {m.remove}
                    </button>
                    <button type="button" onClick={() => setConfirmRemove(null)} className="inline-flex min-h-[44px] items-center rounded-md border border-border px-3 py-2">
                      {m.cancel}
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => setConfirmRemove(member.id)}
                    aria-label={`${m.remove} · ${member.displayName ?? member.email ?? ''}`}
                    className="inline-flex min-h-[44px] items-center rounded-md border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-destructive hover:text-destructive disabled:opacity-60"
                  >
                    {m.remove}
                  </button>
                )
              ) : null}
            </li>
          );
        })}
      </ul>

      {/* Invite-by-email dialog: email + role (admin or member). */}
      {addOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" aria-hidden tabIndex={-1} onClick={closeDialog} className="absolute inset-0 bg-background/80" />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="invite-member-title"
            className="relative w-full max-w-sm rounded-xl border border-border bg-popover p-6 shadow-lg"
          >
            <h2 id="invite-member-title" className="mb-1 text-lg font-semibold">{m.inviteTitle}</h2>
            <p className="mb-4 text-sm text-muted-foreground">{m.inviteLead}</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submitInvite();
              }}
              className="flex flex-col gap-3"
            >
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">{m.emailLabel}</span>
                <input
                  type="email"
                  autoFocus
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder={m.emailPlaceholder}
                  className="rounded-md border border-input bg-background px-3 py-2"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">{m.roleLabel}</span>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as 'admin' | 'member')}
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="member">{m.roleMember}</option>
                  <option value="admin">{m.roleAdmin}</option>
                </select>
              </label>
              {inviteErr ? <p role="alert" className="text-sm text-destructive">{inviteErr}</p> : null}
              <div className="mt-1 flex justify-end gap-2">
                <button type="button" onClick={closeDialog} className="inline-flex min-h-[44px] items-center rounded-md border border-border px-4 py-2.5 text-sm">
                  {m.cancel}
                </button>
                <button
                  type="submit"
                  disabled={pending || !inviteEmail}
                  className="inline-flex min-h-[44px] items-center rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.98] disabled:opacity-60"
                >
                  {m.sendInvite}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
