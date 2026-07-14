'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { Modal } from '@/components/modal';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/toast';
import { inviteMemberAction, type InviteMemberState } from './actions';

export interface InviteMemberLabels {
  addMember: string;
  inviteTitle: string;
  inviteSubtitle: string;
  inviteEmailLabel: string;
  inviteEmailPlaceholder: string;
  inviteRoleLabel: string;
  roleAdmin: string;
  roleMember: string;
  inviteSubmit: string;
  inviteCancel: string;
  inviteSuccess: string;
  inviteErrorTaken: string;
  inviteErrorInvalid: string;
  inviteErrorFailed: string;
}

/**
 * Add-member entry point on the Settings page (admin/owner only). Follows the
 * list/create pattern (Design Quality Bar): a primary trigger opens a dedicated
 * dialog, never an inline form under the list. Submits to `inviteMemberAction`,
 * which creates an `invited` member adopted on their first sign-in. On success
 * the dialog closes, a toast confirms, and the revalidated roster shows the row.
 */
export function InviteMember({ labels }: { labels: InviteMemberLabels }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<InviteMemberState, FormData>(
    inviteMemberAction,
    null,
  );
  const toast = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  // Each action result is a fresh object; handle each exactly once. Without this
  // guard the effect re-fires on every render (the toast context value changes
  // identity each render), stacking duplicate toasts.
  const handledRef = useRef<InviteMemberState>(null);

  // On a successful invite: close the dialog, confirm, and clear the form so a
  // reopen starts clean. The server action already revalidated the roster.
  useEffect(() => {
    if (!state || state === handledRef.current) return;
    handledRef.current = state;
    if (state.ok) {
      setOpen(false);
      formRef.current?.reset();
      toast.success(labels.inviteSuccess);
    }
  }, [state, toast, labels.inviteSuccess]);

  const errorMessage =
    state && !state.ok
      ? state.code === 'TAKEN'
        ? labels.inviteErrorTaken
        : state.code === 'INVALID'
          ? labels.inviteErrorInvalid
          : labels.inviteErrorFailed
      : null;

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <i aria-hidden className="pi pi-plus" style={{ fontSize: 12 }} /> {labels.addMember}
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={labels.inviteTitle}
        labelId="invite-member-title"
      >
        <p className="-mt-2 mb-4 text-sm text-muted-foreground">{labels.inviteSubtitle}</p>
        <form ref={formRef} action={action} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">{labels.inviteEmailLabel}</span>
            <input
              name="email"
              type="email"
              required
              autoComplete="off"
              placeholder={labels.inviteEmailPlaceholder}
              aria-invalid={errorMessage ? true : undefined}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">{labels.inviteRoleLabel}</span>
            <select
              name="role"
              defaultValue="member"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="member">{labels.roleMember}</option>
              <option value="admin">{labels.roleAdmin}</option>
            </select>
          </label>
          {errorMessage ? (
            <p role="alert" className="text-sm text-destructive">
              {errorMessage}
            </p>
          ) : null}
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {labels.inviteCancel}
            </Button>
            <Button type="submit" disabled={pending} className="min-w-[120px]">
              {labels.inviteSubmit}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
