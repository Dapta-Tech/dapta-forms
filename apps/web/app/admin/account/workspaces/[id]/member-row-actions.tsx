'use client';

import { useCallback, useRef, useState, useTransition } from 'react';
import { getMessages } from '@quill/shared';
import { useToast } from '@/components/toast';
import { clientLocale } from '@/lib/client-locale';
import { useConfirmDialog } from '@/components/ui/confirm-dialog';
import { AnchoredMenu } from '@/components/ui/anchored-menu';
import type { AccountRole, MemberStatus } from '@/lib/admin-api';
import { callAction, isTransportError, type TransportError } from '@/lib/call-action';
import {
  removeMemberAction,
  setMemberStatusAction,
  updateMemberRoleAction,
  type ManageMemberState,
} from './actions';

export interface MemberRowActionsLabels {
  membersMenu: string;
  makeAdmin: string;
  makeMember: string;
  activate: string;
  deactivate: string;
  removeMember: string;
  removeConfirm: string;
  roleChangeSuccess: string;
  statusChangeSuccess: string;
  removeSuccess: string;
  manageErrorLastOwner: string;
  manageErrorForbidden: string;
  manageErrorFailed: string;
  manageErrorUpstream: string;
  manageErrorOwnership: string;
}

/**
 * Per-row management controls for a roster member — a single kebab menu
 * (WAI-ARIA menu-button) that mirrors the forms row-actions pattern. Holds the
 * role change (Member ⇄ Admin; an owner target, only reachable when the caller
 * is an owner, can be demoted to either), Activate / Deactivate (never for an
 * `invited` member — they have not accepted yet), and Remove (branded confirm
 * dialog). The API is the real gate; the page only renders this when the
 * caller may manage the row (never for yourself, never an owner unless you are
 * an owner). Every call names the workspace by `accountId`, so Account settings
 * manages any workspace without switching into it.
 *
 * The panel renders through AnchoredMenu (a portal): the row lives inside the
 * table's `overflow-x-auto` scroller, which would clip an absolutely positioned
 * menu on the last rows. Escape / outside-click dismiss and first-item focus
 * come from there. Tokens only; R22 press + pending feedback; every outcome
 * surfaces a localized toast.
 */
export function MemberRowActions({
  accountId,
  memberId,
  role,
  status,
  canRemove,
  labels,
}: {
  accountId: string;
  memberId: string;
  role: AccountRole;
  status: MemberStatus;
  /** Removal is OWNER-only (the identity service's rule); admins get the role + status items only. */
  canRemove: boolean;
  labels: MemberRowActionsLabels;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const toast = useToast();
  const { confirm: confirmDialog, dialog } = useConfirmDialog();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);

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
          : result.code === 'OWNERSHIP'
            ? labels.manageErrorOwnership
            : result.code === 'UPSTREAM'
              ? labels.manageErrorUpstream
              : labels.manageErrorFailed;
    toast.error(message);
  };

  const changeRole = (next: 'admin' | 'member') => {
    setOpen(false);
    start(async () =>
      handle(
        await callAction(() => updateMemberRoleAction(accountId, memberId, next)),
        labels.roleChangeSuccess,
      ),
    );
  };

  const changeStatus = (next: 'active' | 'disabled') => {
    setOpen(false);
    start(async () =>
      handle(
        await callAction(() => setMemberStatusAction(accountId, memberId, next)),
        labels.statusChangeSuccess,
      ),
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
          handle(await callAction(() => removeMemberAction(accountId, memberId)), labels.removeSuccess),
        );
    });
  };

  const itemClass =
    'flex w-full items-center gap-2.5 rounded-sm px-2 py-2 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:outline-none disabled:opacity-50';

  return (
    <div className="relative inline-flex shrink-0">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={labels.membersMenu}
        title={labels.membersMenu}
        disabled={pending}
        data-testid="member-actions-trigger"
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-[0.98] disabled:opacity-50"
      >
        <i
          aria-hidden
          className={`pi ${pending ? 'pi-spinner pi-spin' : 'pi-ellipsis-v'}`}
          style={{ fontSize: 15 }}
        />
      </button>

      <AnchoredMenu
        anchorRef={triggerRef}
        open={open}
        onClose={close}
        label={labels.membersMenu}
        width={208}
        autoFocus
        className="p-1.5"
        testId="member-actions-menu"
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

        {/* Status is only a lever once they are in: an invitation is accepted
            by signing in, never flipped from here. */}
        {status === 'disabled' ? (
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            disabled={pending}
            onClick={() => changeStatus('active')}
            className={itemClass}
          >
            <i aria-hidden className="pi pi-check-circle text-muted-foreground" style={{ fontSize: 13 }} />
            {labels.activate}
          </button>
        ) : null}
        {status === 'active' ? (
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            disabled={pending}
            onClick={() => changeStatus('disabled')}
            className={itemClass}
          >
            <i aria-hidden className="pi pi-ban text-muted-foreground" style={{ fontSize: 13 }} />
            {labels.deactivate}
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
      </AnchoredMenu>
      {dialog}
    </div>
  );
}
