'use client';

import { useTransition } from 'react';
import { duplicateFormAction, deleteFormAction } from './actions';

/** Duplicate / delete buttons for a form row (client → server actions). */
export function FormRowActions({
  id,
  labels,
}: {
  id: string;
  labels: { duplicate: string; delete: string; deleteConfirm: string };
}) {
  const [pending, start] = useTransition();
  return (
    <div className="flex items-center gap-3 text-sm">
      <button
        type="button"
        disabled={pending}
        onClick={() => start(() => void duplicateFormAction(id))}
        className="text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
      >
        {labels.duplicate}
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (confirm(labels.deleteConfirm)) {
            start(() => void deleteFormAction(id));
          }
        }}
        className="text-destructive transition-opacity hover:opacity-80 disabled:opacity-50"
      >
        {labels.delete}
      </button>
    </div>
  );
}
