'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import type { BookingMessages } from '@slate/shared';
import { useToast } from '@/components/toast';
import { inviteMemberByEmailAction, removeMemberAction, setMemberRoleAction } from './actions';

type TeamsMessages = BookingMessages['admin']['teams'];

interface Member {
  member_id: string;
  role: string;
  display_name: string | null;
  email: string | null;
}

const initialOf = (m: { display_name: string | null; email: string | null }) =>
  (m.display_name?.trim()?.[0] ?? m.email?.trim()?.[0] ?? '?').toUpperCase();

export function TeamMembersPanel({
  teamId,
  members,
  messages: m,
}: {
  teamId: string;
  members: Member[];
  messages: TeamsMessages;
}) {
  const [pending, start] = useTransition();
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'owner' | 'member'>('member');
  const [inviteErr, setInviteErr] = useState<string | null>(null);
  const { success, error } = useToast();
  const triggerRef = useRef<HTMLButtonElement>(null);

  const ownerCount = members.filter((mem) => mem.role === 'owner').length;

  // Close on Escape and restore focus to the trigger when the dialog closes.
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
      const r = await inviteMemberByEmailAction(teamId, inviteEmail, inviteRole);
      if (r.ok) {
        success(m.memberAdded);
        setInviteEmail('');
        setInviteRole('member');
        closeDialog();
        return;
      }
      // Localize the stable code; pass a BE 409 message through verbatim.
      setInviteErr(
        r.code === 'INVALID_EMAIL'
          ? m.emailInvalid
          : r.code === 'NO_MATCH'
            ? m.noAccountMember
            : (r.message ?? m.genericError),
      );
    });

  return (
    <div className="flex flex-col gap-4 rounded-md border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-muted-foreground">{m.members}</span>
        <button
          ref={triggerRef}
          type="button"
          onClick={() => {
            setInviteErr(null);
            setAddOpen(true);
          }}
          className="inline-flex min-h-[44px] items-center rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-transform active:scale-[0.98]"
        >
          {m.addMember}
        </button>
      </div>

      {members.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
          {m.noMembers}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {members.map((member) => {
            const isOwner = member.role === 'owner';
            const isLastOwner = isOwner && ownerCount === 1;
            return (
              <li key={member.member_id} className="flex flex-wrap items-center gap-3 py-3">
                {/* Member avatar — an initials monogram (members carry no image URL). */}
                <span
                  aria-hidden
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-background text-xs font-semibold text-muted-foreground"
                >
                  {initialOf(member)}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium">{member.display_name ?? member.member_id.slice(0, 8)}</span>
                  {/* Email line (or a Pending label when the member hasn't a resolved email). */}
                  <span className="truncate text-xs text-muted-foreground">{member.email ?? m.memberPending}</span>
                </span>
                {/* Role pill (owner = accent) with an inline change select; the last
                    owner's role is locked so the team can't be left ownerless. */}
                <span
                  className={`rounded-sm px-2 py-0.5 text-xs font-medium ${
                    isOwner ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {isOwner ? m.roleOwner : m.roleMember}
                </span>
                <select
                  value={isOwner ? 'owner' : 'member'}
                  disabled={pending || isLastOwner}
                  title={isLastOwner ? m.lastOwnerTitle : undefined}
                  aria-label={m.role}
                  onChange={(e) => run(setMemberRoleAction(teamId, member.member_id, e.target.value as 'owner' | 'member'), m.roleUpdated)}
                  className="min-h-[44px] rounded-md border border-input bg-background px-2 py-2 text-sm disabled:opacity-60"
                >
                  <option value="owner">{m.roleOwner}</option>
                  <option value="member">{m.roleMember}</option>
                </select>
                {/* Owner-lock: owners show a lock (no remove affordance); demote to
                    member first to remove. Members get a styled remove-confirm. */}
                {isOwner ? (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground" title={m.ownerLock}>
                    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} aria-hidden>
                      <rect x="5" y="11" width="14" height="9" rx="2" />
                      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
                    </svg>
                    <span className="sr-only">{m.ownerLock}</span>
                  </span>
                ) : confirmRemove === member.member_id ? (
                  <span className="flex items-center gap-1 text-sm">
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => run(removeMemberAction(teamId, member.member_id), m.memberRemoved)}
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
                    onClick={() => setConfirmRemove(member.member_id)}
                    aria-label={`${m.remove} · ${member.display_name ?? member.email ?? ''}`}
                    className="inline-flex min-h-[44px] items-center rounded-md border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-destructive hover:text-destructive disabled:opacity-60"
                  >
                    {m.remove}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Invite-by-email dialog (old-app parity): email + role chosen at add time. */}
      {addOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" aria-hidden tabIndex={-1} onClick={closeDialog} className="absolute inset-0 bg-background/80" />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="invite-dialog-title"
            className="relative w-full max-w-sm rounded-xl border border-border bg-popover p-6 shadow-lg"
          >
            <h2 id="invite-dialog-title" className="mb-1 text-lg font-semibold">{m.inviteTitle}</h2>
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
                <span className="text-muted-foreground">{m.role}</span>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as 'owner' | 'member')}
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="member">{m.roleMember}</option>
                  <option value="owner">{m.roleOwner}</option>
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
