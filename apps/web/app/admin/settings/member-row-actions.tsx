'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { getMessages } from '@quill/shared';
import { useToast } from '@/components/toast';
import { clientLocale } from '@/lib/client-locale';
import { useConfirmDialog } from '@/components/ui/confirm-dialog';
import type { AccountRole } from '@/lib/admin-api';
import { callAction, isTransportError, type TransportError } from '@/lib/call-action';
import {
  removeMemberAction,
  updateMemberRoleAction,
  type ManageMemberState,
} from './actions';

export interface MemberRowActionsLabels {
  membersMenu: string;
  makeAdmin: string;
  makeMember: string;
  removeMember: string;
  removeConfirm: string;
  roleChangeSuccess: string;
  removeSuccess: string;
  manageErrorLastOwner: string;
  manageErrorForbidden: string;
  manageErrorFailed: string;
  manageErrorUpstream: string;
}

/**
 * Per-row management controls for a roster member — a single kebab menu
 * (WAI-ARIA menu-button) that mirrors the forms row-actions pattern. Holds the
 * role change (Member ⇄ Admin; an owner target, only reachable when the caller
 * is an owner, can be demoted to either) and Remove (branded confirm dialog). The API is
 * the real gate; the page only renders this when the caller may manage the row
 * (never for yourself, never an owner unless you are an owner). Escape /
 * outside-click dismiss; focus the first item on open. Tokens only; R22 press +
 * pending feedback; every outcome surfaces a localized toast.
 */
export function MemberRowActions({
  memberId,
  role,
  canRemove,
  labels,
}: {
  memberId: string;
  role: AccountRole;
  /** Removal is OWNER-only (the identity service's rule); admins get the role items only. */
  canRemove: boolean;
  labels: MemberRowActionsLabels;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const toast = useToast();
  const { confirm: confirmDialog, dialog } = useConfirmDialog();
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open]);

  /** Turn a failure code into its localized toast; success carries its own message. */
  const handle = (result: ManageMemberState | TransportError, successMessage: string) => {
    if (isTransportError(result)) {
      toast.error(labels.manageErrorFailed);
      return;
    }
    if (result.ok) {
      toast.success(successMessage);
      return;
    }
    const message =
      result.code === 'LAST_OWNER'
        ? labels.manageErrorLastOwner
        : result.code === 'FORBIDDEN'
          ? labels.manageErrorForbidden
          : result.code === 'UPSTREAM'
            ? labels.manageErrorUpstream
            : labels.manageErrorFailed;
    toast.error(message);
  };

  const changeRole = (next: 'admin' | 'member') => {
    setOpen(false);
    start(async () =>
      handle(await callAction(() => updateMemberRoleAction(memberId, next)), labels.roleChangeSuccess),
    );
  };

  const remove = () => {
    setOpen(false);
    void confirmDialog({
      title: getMessages(clientLocale()).dialog.removeMemberTitle,
      message: labels.removeConfirm,
      confirmLabel: labels.removeMember,
      destructive: true,
    }).then((ok) => {
      if (ok)
        start(async () =>
          handle(await callAction(() => removeMemberAction(memberId)), labels.removeSuccess),
        );
    });
  };

  const itemClass =
    'flex w-full items-center gap-2.5 rounded-sm px-2 py-2 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:outline-none disabled:opacity-50';

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={labels.membersMenu}
        title={labels.membersMenu}
        disabled={pending}
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-[0.98] disabled:opacity-50"
      >
        <i aria-hidden className="pi pi-ellipsis-v" style={{ fontSize: 15 }} />
      </button>

      {open ? (
        <div
          ref={menuRef}
          role="menu"
          aria-label={labels.membersMenu}
          className="absolute right-0 z-50 mt-2 w-52 rounded-md border border-border bg-popover p-1.5 text-popover-foreground shadow-lg"
        >
          {role !== 'admin' ? (
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              disabled={pending}
              onClick={() => changeRole('admin')}
              className={itemClass}
            >
              <i aria-hidden className="pi pi-shield text-muted-foreground" style={{ fontSize: 13 }} />
              {labels.makeAdmin}
            </button>
          ) : null}
          {role !== 'member' ? (
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              disabled={pending}
              onClick={() => changeRole('member')}
              className={itemClass}
            >
              <i aria-hidden className="pi pi-user text-muted-foreground" style={{ fontSize: 13 }} />
              {labels.makeMember}
            </button>
          ) : null}

          {canRemove ? (
            <>
              <div className="my-1 border-t border-border" role="separator" />
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                disabled={pending}
                onClick={remove}
                className="flex w-full items-center gap-2.5 rounded-sm px-2 py-2 text-left text-sm text-destructive transition-colors hover:bg-destructive/10 focus-visible:bg-destructive/10 focus-visible:outline-none disabled:opacity-50"
              >
                <i aria-hidden className="pi pi-trash" style={{ fontSize: 13 }} />
                {labels.removeMember}
              </button>
            </>
          ) : null}
        </div>
      ) : null}
      {dialog}
    </div>
  );
}
