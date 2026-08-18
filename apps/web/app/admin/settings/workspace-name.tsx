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
 * so the Dapta app shows the new name too.
 */
export function WorkspaceName({
  initial,
  canEdit,
  labels,
}: {
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
      <div>
        <dt className="text-xs font-medium uppercase tracking-wide text-faint">{labels.workspaceName}</dt>
        <dd className="mt-1 text-sm text-foreground" data-testid="workspace-name">
          {initial}
        </dd>
      </div>
    );
  }

  return (
    <form action={action} className="sm:col-span-2" data-testid="workspace-name-form">
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-xs font-medium uppercase tracking-wide text-faint">{labels.workspaceName}</span>
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
            className="w-full max-w-md rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button type="submit" size="sm" disabled={pending}>
            {labels.workspaceNameSave}
          </Button>
        </div>
      </label>
    </form>
  );
}
