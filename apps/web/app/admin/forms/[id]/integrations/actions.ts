'use server';

import { unstable_rethrow } from 'next/navigation';

import { revalidatePath } from 'next/cache';
import { adminApi, type WebhookPingResult } from '@/lib/admin-api';
import type { FormDestination } from '@quill/types';

/**
 * Save the integrations (destinations) for a form. Uses the API's PARTIAL
 * `destinations` write (PUT /v1/forms/:id/destinations) which merges only that
 * key against the form's fresh config server-side in ONE request — a concurrent
 * editor save of steps/cover/scoring is never clobbered by this screen (the old
 * shape read the whole config here and wrote it back across two requests,
 * racing the editor).
 *
 * NOTE (optimistic locking): true write-write safety on the SAME key (e.g. two
 * integrations tabs) still needs config versioning / compare-and-set — a general
 * question for every config writer, tracked separately and out of scope here.
 */
export async function saveIntegrationsAction(
  id: string,
  destinations: FormDestination[],
): Promise<{ ok: boolean; message?: string; formActivityError?: string }> {
  try {
    // The API builds the HubSpot mirror form as part of this write and reports
    // a refusal without failing the save — an author must be able to edit their
    // mappings while a portal is unreachable or has not granted the scopes.
    const saved = await adminApi.updateFormDestinations(id, destinations);
    revalidatePath(`/admin/forms/${id}/integrations`);
    const reason = (saved as { formActivityError?: string }).formActivityError;
    return reason ? { ok: true, formActivityError: reason } : { ok: true };
  } catch (e) {
    unstable_rethrow(e);
    return {
      ok: false,
      message: e instanceof Error ? e.message : 'Failed to save.',
    };
  }
}

/**
 * Send one sample delivery to this form's configured webhook.
 *
 * The API does the work — and the guarding: admin-only, scoped to the caller's
 * account, and routed through the real adapter so the SSRF check that protects
 * every live delivery protects this one too.
 */
export async function pingWebhookAction(id: string): Promise<WebhookPingResult> {
  try {
    return await adminApi.pingWebhook(id);
  } catch (e) {
    unstable_rethrow(e);
    return {
      ok: false,
      reason: 'unknown',
      message: e instanceof Error ? e.message : 'Could not reach the webhook.',
    };
  }
}
