/**
 * The column plan of a Google Sheets destination: what the editor starts from,
 * and the rules a row list has to obey before it is saved.
 *
 * Pure and co-located, like `auto-map.ts` next door and for the same reason:
 * the interesting decisions here (what a sensible first plan is, which rows are
 * incomplete, what moving a row means) are worth testing without mounting an
 * editor around them.
 */
import { hasScoringSignal, type FormConfig } from '@quill/engine';
import { isWritableSheetColumn, sheetCells, type SheetColumn, type SheetColumnSource } from '@quill/types';
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
 *
 * The score and the outcome follow the same rule: they are offered only when
 * the form can produce them (`scoring`), since on a form without scoring every
 * cell under them would be empty. Absent means "unknown" and keeps both, which
 * is what every caller got before the form's scoring was passed in.
 */
export function defaultColumns(
  questions: QuestionMeta[],
  labels: StandardColumnLabels,
  scoring: { score: boolean; outcome: boolean } = { score: true, outcome: true },
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
    ...(scoring.score ? [{ header: labels.score, source: 'score' as SheetColumnSource }] : []),
    ...(scoring.outcome ? [{ header: labels.outcome, source: 'outcome' as SheetColumnSource }] : []),
  ];
}

/**
 * Which of the score and outcome columns a form can fill: a score once it
 * carries any scoring signal and scoring is not switched off, an outcome only
 * when it also has a range to land in. The same signal the API uses before it
 * stores a score at all (`hasScoringSignal`).
 */
export function scoringColumns(config: FormConfig): { score: boolean; outcome: boolean } {
  const score = config.scoring?.enabled !== false && hasScoringSignal(config);
  return { score, outcome: score && (config.outcomes ?? []).length > 0 };
}

/**
 * Is this column in the sheet? The API's own rule (`isWritableSheetColumn`:
 * it has a heading), so the card's letters, row 1 and every delivered row
 * agree on which columns exist and in what order.
 */
export function isCompleteColumn(column: SheetColumn): boolean {
  return isWritableSheetColumn(column);
}

/**
 * What a column still needs, or null when it is done.
 *
 * `header`: no heading, so it is not in the sheet at all. `source`: it is in
 * the sheet (heading in row 1), but nothing fills its cells yet, so they stay
 * empty until an answer or a campaign tag is chosen.
 */
export function columnMissing(column: SheetColumn): 'header' | 'source' | null {
  if (!column.header.trim()) return 'header';
  if ((column.source === 'answer' || column.source === 'utm') && !column.key?.trim()) return 'source';
  return null;
}

/** Where one column of the card sits in the sheet. */
export interface SheetPosition {
  /** Its zero-based position in the row, or null for a column that is not in the sheet. */
  index: number | null;
  /**
   * The heading row 1 still holds for a column whose heading was cleared:
   * the position is kept (empty cells) until the column is named again or
   * deleted. Null for every other column.
   */
  heldHeader: string | null;
}

/**
 * Each column's position in the SHEET, by the API's own rule (`sheetCells`),
 * so the card, row 1 and every delivered row count the same way. `written`
 * is the row 1 dForms last wrote for this sheet (null when it wrote none).
 */
export function sheetPositions(columns: SheetColumn[], written?: readonly string[] | null): SheetPosition[] {
  const cells = sheetCells(columns, written);
  const at = new Map(cells.map((cell, i) => [cell.column, i] as const));
  return columns.map((column) => {
    const index = at.get(column);
    if (index === undefined) return { index: null, heldHeader: null };
    return { index, heldHeader: cells[index]!.held ? cells[index]!.header : null };
  });
}

/**
 * Each column's letter in the SHEET, or null for one that is not written.
 * Letters count the sheet's cells only, so the card reads A, B, C, (none), D
 * for a row where the fourth column never had a heading, exactly as row 1
 * does, and a column whose heading was cleared keeps the letter it holds.
 */
export function sheetLetters(
  columns: SheetColumn[],
  letter: (i: number) => string,
  written?: readonly string[] | null,
): (string | null)[] {
  return sheetPositions(columns, written).map((p) => (p.index === null ? null : letter(p.index)));
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
