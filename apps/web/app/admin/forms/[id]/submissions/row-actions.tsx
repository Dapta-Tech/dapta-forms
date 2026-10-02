'use client';

import { useState, useTransition } from 'react';
import { getMessages } from '@quill/shared';
import { clientLocale } from '@/lib/client-locale';
import { useConfirmDialog } from '@/components/ui/confirm-dialog';
import { deleteSubmissionAction, deleteSubmissionQuietAction } from './actions';
import { callAction, isTransportError } from '@/lib/call-action';

/**
 * `md` is the red pill in the response panel's footer: the same destructive
 * pill the delivery history and webhooks use for a failure, made clickable.
 * `icon` sits at the end of a table row, where a red pill on every line
 * outweighed the answers: a quiet bin that turns red under the pointer.
 */
const PILL = {
  sm: 'h-7 gap-1.5 rounded-full border border-destructive/40 bg-destructive/10 px-3 text-xs font-medium text-destructive hover:border-destructive/60 hover:bg-destructive/20',
  md: 'h-9 gap-2 rounded-full border border-destructive/40 bg-destructive/10 px-4 text-sm font-medium text-destructive hover:border-destructive/60 hover:bg-destructive/20',
  icon: 'h-8 w-8 justify-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive',
} as const;

/** Delete-with-confirm for a submission row (branded dialog → server action). */
export function DeleteSubmissionButton({
  formId,
  submissionId,
  labels,
  size = 'sm',
  onDeleted,
}: {
  formId: string;
  submissionId: string;
  labels: { delete: string; confirm: string };
  size?: keyof typeof PILL;
  /**
   * Given, the delete revalidates nothing and this is called once it went
   * through: the caller refreshes its own page. The Summary needs it (see
   * `deleteSubmissionQuietAction`); the table leaves it out.
   */
  onDeleted?: () => void;
}) {
  const [inTransition, start] = useTransition();
  const [busy, setBusy] = useState(false);
  const pending = inTransition || busy;
  const { confirm: confirmDialog, dialog } = useConfirmDialog();
  const run = () => {
    if (!onDeleted) {
      start(() => void callAction(() => deleteSubmissionAction(formId, submissionId)));
      return;
    }
    setBusy(true);
    void callAction(() => deleteSubmissionQuietAction(submissionId)).then((res) => {
      setBusy(false);
      if (!isTransportError(res) && res.ok) onDeleted();
    });
  };
  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          void confirmDialog({
            title: getMessages(clientLocale()).dialog.deleteSubmissionTitle,
            message: labels.confirm,
            confirmLabel: labels.delete,
            destructive: true,
          }).then((ok) => {
            if (ok) run();
          });
        }}
        aria-label={size === 'icon' ? labels.delete : undefined}
        title={size === 'icon' ? labels.delete : undefined}
        className={`inline-flex shrink-0 items-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/50 disabled:opacity-50 ${PILL[size]}`}
      >
        <i aria-hidden className="pi pi-trash" style={{ fontSize: size === 'sm' ? 10 : size === 'md' ? 12 : 13 }} />
        {size === 'icon' ? null : labels.delete}
      </button>
      {dialog}
    </>
  );
}
