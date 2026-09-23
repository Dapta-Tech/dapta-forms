import type { SummaryAnswer } from '@quill/engine';
import { formatDateTime, type Locale } from '@quill/shared';

/**
 * One text answer as a Summary card lists it: the answer, who wrote it, and
 * when, already formatted on the server in the workspace zone (the same
 * reading as the table), so the card never formats a date itself.
 */
export interface SummaryHit {
  id: string;
  text: string;
  /** Null when the form asked for no name, email or phone. */
  respondent: string | null;
  when: string;
}

export function toSummaryHit(
  a: SummaryAnswer,
  opts: { locale: Locale; timeZone: string },
): SummaryHit {
  return { id: a.id, text: a.text, respondent: a.respondent, when: formatDateTime(a.at, opts) };
}
