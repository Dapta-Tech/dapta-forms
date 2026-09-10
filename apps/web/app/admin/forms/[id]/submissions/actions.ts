'use server';

import { revalidatePath } from 'next/cache';
import { adminApi } from '@/lib/admin-api';

/** Delete a submission, then refresh the form's submissions table. */
export async function deleteSubmissionAction(formId: string, submissionId: string): Promise<void> {
  await adminApi.deleteSubmission(submissionId);
  revalidatePath(`/admin/forms/${formId}/submissions`);
}

/**
 * Mint a short-lived download URL for one uploaded file.
 *
 * A server action rather than a direct client call, because `adminApi` carries
 * the session cookie and is server-only. Nothing is revalidated: reading a file
 * changes no state on the page.
 */
export async function submissionFileUrlAction(
  formId: string,
  submissionId: string,
  stepKey: string,
): Promise<{ ok: true; url: string } | { ok: false }> {
  try {
    const { url } = await adminApi.submissionFile(formId, submissionId, stepKey);
    return { ok: true, url };
  } catch {
    // Expired, deleted, or not this account's. The button says so; the reason
    // stays here, because telling a caller which of those it was would confirm
    // that another workspace's submission exists.
    return { ok: false };
  }
}
