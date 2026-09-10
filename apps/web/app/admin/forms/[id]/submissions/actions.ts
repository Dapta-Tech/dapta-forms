'use server';

import { revalidatePath } from 'next/cache';
import type { SubmissionFile } from '@quill/types';
import { adminApi } from '@/lib/admin-api';

/** Delete a submission, then refresh the form's submissions table. */
export async function deleteSubmissionAction(formId: string, submissionId: string): Promise<void> {
  await adminApi.deleteSubmission(submissionId);
  revalidatePath(`/admin/forms/${formId}/submissions`);
}

/**
 * Open one uploaded file: a short-lived download URL, plus a second one to show
 * it in place when the API judged its type safe to render.
 *
 * A server action rather than a direct client call, because `adminApi` carries
 * the session cookie and is server-only. Nothing is revalidated: reading a file
 * changes no state on the page.
 *
 * `kind` comes back from the API rather than being worked out here on purpose.
 * Which viewer may point at a file is a decision about what the browser is
 * allowed to execute, and that belongs on the side of the wire that verified
 * what the file actually is.
 */
export async function submissionFileUrlAction(
  formId: string,
  submissionId: string,
  stepKey: string,
): Promise<{ ok: true; file: SubmissionFile } | { ok: false }> {
  try {
    return { ok: true, file: await adminApi.submissionFile(formId, submissionId, stepKey) };
  } catch {
    // Expired, deleted, or not this account's. The button says so; the reason
    // stays here, because telling a caller which of those it was would confirm
    // that another workspace's submission exists.
    return { ok: false };
  }
}
