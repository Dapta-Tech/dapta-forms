'use server';

import { postSubmission, postFormEvent } from '@/lib/api';

/** Submit a completed form (score recomputed server-side). */
export async function submitFormAction(
  accountCode: string,
  slug: string,
  payload: { sessionId: string; data: Record<string, unknown> },
): Promise<{ ok: boolean; score?: number; outcome?: string | null; message?: string }> {
  const res = await postSubmission(accountCode, slug, payload);
  return { ok: res.ok, score: res.score, outcome: res.outcome, message: res.message };
}

/** Record a funnel event (best-effort). */
export async function recordEventAction(
  accountCode: string,
  slug: string,
  payload: { sessionId: string; type: string; stepIndex?: number | null },
): Promise<void> {
  await postFormEvent(accountCode, slug, payload);
}
