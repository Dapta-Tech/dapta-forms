'use client';

import { useTransition } from 'react';
import { duplicateFormAction, deleteFormAction } from './actions';

/** Duplicate / delete buttons for a form row (client → server actions). */
export function FormRowActions({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex items-center gap-3 text-sm">
      <button
        type="button"
        disabled={pending}
        onClick={() => start(() => void duplicateFormAction(id))}
        className="text-muted-foreground hover:text-foreground disabled:opacity-50"
      >
        Duplicate
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (confirm('Delete this form and all its submissions?')) {
            start(() => void deleteFormAction(id));
          }
        }}
        className="text-destructive hover:opacity-80 disabled:opacity-50"
      >
        Delete
      </button>
    </div>
  );
}
