/**
 * The column plan of a Google Sheets destination: what the editor starts from,
 * and the rules a row list has to obey before it is saved.
 *
 * Pure and co-located, like `auto-map.ts` next door and for the same reason:
 * the interesting decisions here (what a sensible first plan is, which rows are
 * incomplete, what moving a row means) are worth testing without mounting an
 * editor around them.
 */
import { isWritableSheetColumn, type SheetColumn, type SheetColumnSource } from '@quill/types';
import type { QuestionMeta } from './auto-map';

/** The headers of the columns that are not questions, in the author's language. */
export interface StandardColumnLabels {
  submittedAt: string;
  score: string;
  outcome: string;
  formName: string;
  submissionId: string;
}

/**
 * The plan an author gets when they first point a form at a spreadsheet.
 *
 * A date first, then the questions in the order the form asks them, then the
 * score and the outcome. That order is not arbitrary: a sheet is read left to
 * right and sorted by its first column, and the thing people sort submissions
 * by is when they arrived. The questions keep the form's own order so the sheet
 * reads like the form rather than like whatever order a record iterated in.
 *
 * UTM columns are deliberately NOT here. Five more columns on every sheet, for
 * something most forms never set, is noise in the common case; an author who
 * runs campaigns adds the one or two they actually use.
 */
export function defaultColumns(
  questions: QuestionMeta[],
  labels: StandardColumnLabels,
): SheetColumn[] {
  return [
    { header: labels.submittedAt, source: 'submitted_at' },
    ...questions.map((q) => ({
      // The question's own label is what the author already calls it. Falling
      // back to the key keeps a column titled rather than blank on a question
      // whose label was never filled in.
      header: (q.label || q.key).slice(0, 200),
      source: 'answer' as SheetColumnSource,
      key: q.key,
    })),
    { header: labels.score, source: 'score' },
    { header: labels.outcome, source: 'outcome' },
  ];
}

/**
 * Does this row say enough to write a cell? The API's own rule
 * (`isWritableSheetColumn`), so the editor, the header row and every
 * delivered row agree on which columns are in the sheet.
 */
export function isCompleteColumn(column: SheetColumn): boolean {
  return isWritableSheetColumn(column);
}

/** What a column still needs before it goes into the sheet, or null when complete. */
export function columnMissing(column: SheetColumn): 'header' | 'source' | 'both' | null {
  const noHeader = !column.header.trim();
  const noSource = (column.source === 'answer' || column.source === 'utm') && !column.key?.trim();
  return noHeader && noSource ? 'both' : noHeader ? 'header' : noSource ? 'source' : null;
}

/**
 * The plan as it should be STORED: every row, incomplete ones included,
 * headers trimmed and empty keys left out.
 *
 * Incomplete rows used to be dropped here, which made the save pill's
 * "saved" a lie about them: a column with a heading and no answer yet was on
 * screen, called saved, and gone after a reload. Stored, it survives; the
 * API leaves it out of the sheet (row 1 and every delivered row) until it is
 * complete, so storing it changes nothing a respondent's row looks like.
 */
export function storedColumns(columns: SheetColumn[]): SheetColumn[] {
  return columns.map((c) => ({
    header: c.header.trim(),
    source: c.source,
    ...(c.key?.trim() ? { key: c.key.trim() } : {}),
  }));
}

/**
 * Move one row up or down, returning a new list.
 *
 * Order IS the configuration here, unlike a CRM mapping where it means nothing,
 * so this is a real operation rather than a nicety. Out-of-range moves return
 * the list unchanged so the first row's "up" and the last row's "down" are
 * harmless rather than guarded at every call site.
 */
export function moveColumn(columns: SheetColumn[], index: number, delta: number): SheetColumn[] {
  const to = index + delta;
  if (index < 0 || index >= columns.length || to < 0 || to >= columns.length) return columns;
  const next = [...columns];
  const [moved] = next.splice(index, 1);
  next.splice(to, 0, moved!);
  return next;
}

/**
 * Is the plan one the author would recognise as "the same columns as before"?
 *
 * Used to decide whether a sheet whose header row was already written still
 * matches what is about to be appended. Headers only, in order: the source
 * behind a column can change (an author re-points a column at another question)
 * without the spreadsheet's own heading needing to move.
 */
export function sameHeaders(a: SheetColumn[], b: SheetColumn[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((column, i) => column.header.trim() === b[i]!.header.trim());
}
