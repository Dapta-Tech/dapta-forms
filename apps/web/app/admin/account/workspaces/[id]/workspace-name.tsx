'use client';

import { useActionState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/toast';
import { renameWorkspaceAction, type RenameWorkspaceState } from '@/app/admin/workspace-actions';

export interface WorkspaceNameLabels {
  workspaceName: string;
  workspaceNameSave: string;
  workspaceNameSaved: string;
  workspaceNameError: string;
}

/**
 * The workspace's name, editable by admins/owners. Renames upstream first when
 * the identity service is configured (the server action goes through the API),
 * so the Dapta app shows the new name too. `accountId` names the workspace in
 * a hidden input, so Account settings can rename any workspace the caller
 * administers without switching into it.
 */
export function WorkspaceName({
  accountId,
  initial,
  canEdit,
  labels,
}: {
  accountId: string;
  initial: string;
  canEdit: boolean;
  labels: WorkspaceNameLabels;
}) {
  const [state, action, pending] = useActionState<RenameWorkspaceState, FormData>(
    renameWorkspaceAction,
    null,
  );
  const toast = useToast();
  const handledRef = useRef<RenameWorkspaceState>(null);

  useEffect(() => {
    if (!state || state === handledRef.current) return;
    handledRef.current = state;
    if (state.ok) toast.success(labels.workspaceNameSaved);
    else toast.error(labels.workspaceNameError);
  }, [state, toast, labels.workspaceNameSaved, labels.workspaceNameError]);

  if (!canEdit) {
    return (
      <div className="min-w-0">
        <p className="text-2xs uppercase tracking-wide text-faint">{labels.workspaceName}</p>
        <h2 className="mt-1 truncate text-2xl font-semibold tracking-tight" data-testid="workspace-name">
          {initial}
        </h2>
      </div>
    );
  }

  return (
    <form action={action} className="min-w-0" data-testid="workspace-name-form">
      <input type="hidden" name="accountId" value={accountId} />
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-2xs uppercase tracking-wide text-faint">{labels.workspaceName}</span>
        <div className="flex items-center gap-2">
          <input
            name="name"
            type="text"
            required
            maxLength={80}
            defaultValue={initial}
            key={initial}
            autoComplete="off"
            data-testid="workspace-name-input"
            className="w-full max-w-md rounded-md border border-input bg-background px-3 py-2 text-base font-semibold tracking-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button type="submit" size="sm" disabled={pending}>
            {labels.workspaceNameSave}
          </Button>
        </div>
      </label>
    </form>
  );
}
