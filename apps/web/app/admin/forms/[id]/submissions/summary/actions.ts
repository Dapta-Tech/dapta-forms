'use server';

import type { FormConfig } from '@quill/types';
import { isInputlessStep } from '@quill/engine';
import { adminApi } from '@/lib/admin-api';
import { getLocale } from '@/lib/locale';
import { buildResponseDetail, type ResponseDetail } from '../response-detail';
import { toSummaryHit, type SummaryHit } from './summary-hit';

/** How many answers one "Show more" (or one search) brings. */
const PAGE = 10;

/**
 * One text question's answers containing `query` (every answer when blank),
 * from `offset`. A server action because `adminApi` carries the session and is
 * server-only; the API scopes it to the caller's account.
 */
export async function searchSummaryAnswersAction(
  formId: string,
  stepKey: string,
  query: string,
  offset: number,
): Promise<{ ok: true; items: SummaryHit[]; total: number } | { ok: false }> {
  try {
    const [page, me, locale] = await Promise.all([
      adminApi.searchSummaryAnswers(formId, stepKey, { q: query, offset, limit: PAGE }),
      adminApi.me(),
      getLocale(),
    ]);
    const timeZone = me.timezone ?? 'UTC';
    return {
      ok: true,
      items: page.items.map((a) => toSummaryHit(a, { locale, timeZone })),
      total: page.total,
    };
  } catch {
    return { ok: false };
  }
}

/**
 * One response, formatted for the side panel exactly as the Responses table
 * formats it (`buildResponseDetail`). Read by id through the API's account
 * join, so an id from another workspace, or from another form, is a failure
 * like a deleted one, and the caller cannot tell those apart.
 */
export async function summaryResponseAction(
  formId: string,
  submissionId: string,
): Promise<{ ok: true; detail: ResponseDetail } | { ok: false }> {
  try {
    const [form, row, me, locale] = await Promise.all([
      adminApi.getForm(formId),
      adminApi.getSubmission(formId, submissionId),
      adminApi.me(),
      getLocale(),
    ]);
    const config = form.config as FormConfig;
    const steps = (config.steps ?? []).filter((s) => !isInputlessStep(s));
    return {
      ok: true,
      detail: buildResponseDetail(row, steps, {
        locale,
        timeZone: me.timezone ?? 'UTC',
        scoring: config.scoring?.enabled !== false,
      }),
    };
  } catch {
    return { ok: false };
  }
}
