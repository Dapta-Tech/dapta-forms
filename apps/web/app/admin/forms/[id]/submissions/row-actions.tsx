'use client';

import { useTransition } from 'react';
import { getMessages } from '@quill/shared';
import { clientLocale } from '@/lib/client-locale';
import { useConfirmDialog } from '@/components/ui/confirm-dialog';
import { deleteSubmissionAction } from './actions';

/** Delete-with-confirm for a submission row (branded dialog → server action). */
export function DeleteSubmissionButton({
  formId,
  submissionId,
  labels,
}: {
  formId: string;
  submissionId: string;
  labels: { delete: string; confirm: string };
}) {
  const [pending, start] = useTransition();
  const { confirm: confirmDialog, dialog } = useConfirmDialog();
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
            if (ok) start(() => void deleteSubmissionAction(formId, submissionId));
          });
        }}
        className="text-sm text-destructive transition-opacity hover:opacity-80 disabled:opacity-50"
      >
        {labels.delete}
      </button>
      {dialog}
    </>
  );
}
