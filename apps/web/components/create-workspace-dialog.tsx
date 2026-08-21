'use client';

import { useActionState, useEffect, useRef } from 'react';
import type { FormsMessages } from '@quill/shared';
import { Modal } from '@/components/modal';
import { Button } from '@/components/ui/button';
import { createWorkspaceAction, type CreateWorkspaceState } from '@/app/admin/workspace-actions';

type Messages = FormsMessages['admin']['chrome']['workspaces'];

/**
 * "New workspace": one field, then you are in it. Success is a redirect from
 * the server action (the cookie now names the new workspace), so this dialog
 * only ever handles the failure branch itself.
 */
export function CreateWorkspaceDialog({
  open,
  onClose,
  m,
}: {
  open: boolean;
  onClose: () => void;
  m: Messages;
}) {
  const [state, action, pending] = useActionState<CreateWorkspaceState, FormData>(
    createWorkspaceAction,
    null,
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!open) formRef.current?.reset();
  }, [open]);

  const errorMessage =
    state && !state.ok
      ? state.code === 'FORBIDDEN'
        ? m.createErrorForbidden
        : state.code === 'INVALID'
          ? m.createErrorInvalid
          : state.code === 'REJECTED'
            ? state.message
            : m.createErrorFailed
      : null;

  return (
    <Modal open={open} onClose={onClose} title={m.createTitle} labelId="create-workspace-title">
      <p className="-mt-2 mb-4 text-sm text-muted-foreground">{m.createSubtitle}</p>
      <form ref={formRef} action={action} className="flex flex-col gap-4" data-testid="create-workspace-form">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">{m.createNameLabel}</span>
          <input
            name="name"
            type="text"
            required
            maxLength={80}
            autoComplete="off"
            placeholder={m.createNamePlaceholder}
            aria-invalid={errorMessage ? true : undefined}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
        {errorMessage ? (
          <p role="alert" className="text-sm text-destructive">
            {errorMessage}
          </p>
        ) : null}
        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {m.createCancel}
          </Button>
          <Button type="submit" disabled={pending} className="min-w-[120px]" data-testid="create-workspace-submit">
            {pending ? m.creating : m.createSubmit}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
