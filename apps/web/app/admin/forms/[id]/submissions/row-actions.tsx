'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { getMessages } from '@quill/shared';
import { clientLocale } from '@/lib/client-locale';
import { useConfirmDialog } from '@/components/ui/confirm-dialog';
import { deleteSubmissionAction } from './actions';
import { callAction } from '@/lib/call-action';

/**
 * The red pill: the same destructive pill the delivery history and webhooks
 * use for a failure, made clickable. Plain red text read as a label, not a
 * button. `sm` sits in a table row, `md` in the response panel's footer.
 */
const PILL = {
  sm: 'h-7 gap-1.5 px-3 text-xs',
  md: 'h-9 gap-2 px-4 text-sm',
} as const;

/** Delete-with-confirm for a submission row (branded dialog → server action). */
export function DeleteSubmissionButton({
  formId,
  submissionId,
  labels,
  size = 'sm',
}: {
  formId: string;
  submissionId: string;
  labels: { delete: string; confirm: string };
  size?: keyof typeof PILL;
}) {
  const [pending, start] = useTransition();
  const router = useRouter();
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
            if (!ok) return;
            // `revalidatePath` in the action alone left the deleted row on
            // screen in a production build; the refresh redraws the table.
            start(async () => {
              await callAction(() => deleteSubmissionAction(formId, submissionId));
              router.refresh();
            });
          });
        }}
        className={`inline-flex shrink-0 items-center rounded-full border border-destructive/40 bg-destructive/10 font-medium text-destructive transition-colors hover:border-destructive/60 hover:bg-destructive/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/50 disabled:opacity-50 ${PILL[size]}`}
      >
        <i aria-hidden className="pi pi-trash" style={{ fontSize: size === 'md' ? 12 : 10 }} />
        {labels.delete}
      </button>
      {dialog}
    </>
  );
}
