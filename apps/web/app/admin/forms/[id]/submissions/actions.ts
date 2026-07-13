'use server';

import { revalidatePath } from 'next/cache';
import { adminApi } from '@/lib/admin-api';

/** Delete a submission, then refresh the form's submissions table. */
export async function deleteSubmissionAction(formId: string, submissionId: string): Promise<void> {
  await adminApi.deleteSubmission(submissionId);
  revalidatePath(`/admin/forms/${formId}/submissions`);
}
