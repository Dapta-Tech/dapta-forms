'use client';

import { useTransition } from 'react';
import { deleteSubmissionAction } from './actions';

/** Delete-with-confirm for a submission row (client → server action). */
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
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (confirm(labels.confirm)) {
          start(() => void deleteSubmissionAction(formId, submissionId));
        }
      }}
      className="text-sm text-destructive transition-opacity hover:opacity-80 disabled:opacity-50"
    >
      {labels.delete}
    </button>
  );
}
