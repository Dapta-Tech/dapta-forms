'use client';

import Link from 'next/link';
import { useTransition } from 'react';
import { duplicateFormAction, deleteFormAction } from './actions';

/**
 * Per-row actions for a form: cross-links to its Analytics + Submissions pages
 * (analytics track) and Integrations page (destinations track — additive), plus
 * localized Duplicate / Delete (builder track).
 */
export function FormRowActions({
  id,
  labels,
  nav,
}: {
  id: string;
  labels: { duplicate: string; delete: string; deleteConfirm: string };
  nav?: { analytics: string; submissions: string; integrations?: string };
}) {
  const [pending, start] = useTransition();
  return (
    <div className="flex items-center gap-3 text-sm">
      {nav ? (
        <>
          <Link
            href={`/admin/forms/${id}/analytics`}
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            {nav.analytics}
          </Link>
          <Link
            href={`/admin/forms/${id}/submissions`}
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            {nav.submissions}
          </Link>
          {nav.integrations ? (
            <Link
              href={`/admin/forms/${id}/integrations`}
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              {nav.integrations}
            </Link>
          ) : null}
        </>
      ) : null}
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
