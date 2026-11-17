/**
 * Which cells a sheet row holds (`sheetCells`), with and without the row 1
 * dForms last wrote.
 *
 * The bug this pins: an author renaming column B clears its heading first. A
 * column with no heading was dropped from the row, so for as long as the
 * heading stayed empty every later column was delivered one cell to the left.
 * A column whose position dForms already wrote keeps it (an empty cell under
 * the old heading) until it is named again or deleted for real. A column that
 * never had a heading still stays out.
 */
import { describe, expect, it } from 'vitest';
import { sheetBaselineHeaders, sheetCells, writableSheetColumns, writtenSheetHeaders } from './index';

const col = (header: string, key = header.toLowerCase() || 'x') => ({ header, source: 'answer', key });
const shape = (cells: ReturnType<typeof sheetCells>) => cells.map((c) => (c.held ? `(${c.header})` : c.header));

describe('without a recorded row 1', () => {
  it('is the named columns, exactly as before', () => {
    const columns = [col('A'), col(''), col('C')];
    expect(shape(sheetCells(columns))).toEqual(['A', 'C']);
    expect(shape(sheetCells(columns, null))).toEqual(['A', 'C']);
    expect(shape(sheetCells(columns, []))).toEqual(['A', 'C']);
    expect(sheetCells(columns).map((c) => c.column)).toEqual(writableSheetColumns(columns));
  });
});

describe('with the row 1 dForms wrote', () => {
  const written = ['A', 'B', 'C'];

  it('holds the position of a column whose heading was cleared, so C does not move', () => {
    expect(shape(sheetCells([col('A'), col('', 'b'), col('C')], written))).toEqual(['A', '(B)', 'C']);
  });

  it('holds a cleared LAST column too', () => {
    expect(shape(sheetCells([col('A'), col('B'), col('', 'c')], written))).toEqual(['A', 'B', '(C)']);
  });

  it('holds two cleared columns in a row', () => {
    expect(shape(sheetCells([col('A'), col('', 'b'), col('', 'c'), col('D')], ['A', 'B', 'C', 'D']))).toEqual([
      'A',
      '(B)',
      '(C)',
      'D',
    ]);
  });

  it('leaves out a brand-new column with no heading, in the middle or at the end', () => {
    expect(shape(sheetCells([col('A'), col('', 'new'), col('B'), col('C')], written))).toEqual(['A', 'B', 'C']);
    expect(shape(sheetCells([col('A'), col('B'), col('C'), col('', 'new')], written))).toEqual(['A', 'B', 'C']);
  });

  it('tells a cleared column from a new one next to it', () => {
    // B cleared, and a never-named column right after it: one position held.
    expect(shape(sheetCells([col('A'), col('', 'b'), col('', 'new'), col('C')], written))).toEqual(['A', '(B)', 'C']);
  });

  it('holds nothing once the column is deleted for real: row 1 is rewritten for what is left', () => {
    expect(shape(sheetCells([col('A'), col('C')], written))).toEqual(['A', 'C']);
  });

  // By position, not by reading headings ahead. `[A, X, X]` with the first X
  // cleared: the text rule saw "the next heading is X, and so is this
  // position", took the cleared column for a new one, rewrote row 1 as
  // `[A, X]` and moved the third column one cell to the left.
  it('holds a cleared column next to one with the same heading', () => {
    const twice = ['A', 'X', 'X'];
    expect(shape(sheetCells([col('A'), col('', 'x1'), col('X', 'x2')], twice))).toEqual(['A', '(X)', 'X']);
    expect(shape(sheetCells([col('A'), col('X', 'x1'), col('', 'x2')], twice))).toEqual(['A', 'X', '(X)']);
    // And a never-named column in front of two identical headings is still new.
    expect(shape(sheetCells([col('A'), col('', 'new'), col('X', 'x1'), col('X', 'x2')], twice))).toEqual(['A', 'X', 'X']);
  });

  it('keeps the held position when another column is renamed in the same save', () => {
    // B cleared, C renamed to Z: one change (the rename), against two if B were dropped.
    expect(shape(sheetCells([col('A'), col('', 'b'), col('Z')], written))).toEqual(['A', '(B)', 'Z']);
  });

  // The limit: columns have no identity beyond their place in the list, so
  // moving columns AND clearing a heading in one save can only be read as the
  // smallest change that explains it. Pinned so the choice is deliberate:
  // here, the two named columns swapped and the middle position was kept.
  it('reads a reorder plus a clear as the smallest change, consistently', () => {
    expect(shape(sheetCells([col('C'), col('', 'b'), col('A')], written))).toEqual(['C', '(B)', 'A']);
  });

  it('on a tie leaves the unnamed column out (it is new until something says otherwise)', () => {
    expect(shape(sheetCells([col('', 'new'), col('A')], ['A']))).toEqual(['A']);
  });

  it('is exact for a wide sheet (every position kept around a cleared one)', () => {
    const wide = Array.from({ length: 60 }, (_, i) => `H${i}`);
    const columns = wide.map((h, i) => (i === 30 ? col('', 'k30') : col(h, `k${i}`)));
    const cells = sheetCells(columns, wide);
    expect(cells).toHaveLength(60);
    expect(cells[30]).toMatchObject({ held: true, header: 'H30' });
    expect(cells[59]).toMatchObject({ held: false, header: 'H59' });
  });

  it('keeps a column added after the recorded row', () => {
    expect(shape(sheetCells([col('A'), col('', 'b'), col('C'), col('D')], written))).toEqual(['A', '(B)', 'C', 'D']);
  });
});

describe('the recorded row 1 of a stored destination', () => {
  const snapshot = { spreadsheetId: 's1', sheetTitle: 'Responses', headers: ['A', 'B'] };

  it('is read for the same spreadsheet and tab', () => {
    expect(
      writtenSheetHeaders({ settings: { spreadsheetId: 's1', sheetTitle: 'Responses', headerSnapshot: snapshot } }),
    ).toEqual(['A', 'B']);
  });

  // A row 1 that is somebody else's has no snapshot, but the headings these
  // columns stood for when that was found are on record, and they say which
  // positions the columns occupy just the same.
  it('falls back to what was recorded for a foreign row 1', () => {
    const foreign = { spreadsheetId: 's1', sheetTitle: 'Responses', headers: ['A', 'B', 'C'] };
    expect(
      writtenSheetHeaders({ settings: { spreadsheetId: 's1', sheetTitle: 'Responses', headerForeign: foreign } }),
    ).toEqual(['A', 'B', 'C']);
    expect(
      writtenSheetHeaders({
        settings: { spreadsheetId: 's1', sheetTitle: 'Responses', headerSnapshot: snapshot, headerForeign: foreign },
      }),
    ).toEqual(['A', 'B']);
  });

  // A destination saved before anything was recorded: its stored columns are
  // what its row 1 was written from, so they are the baseline for its FIRST
  // edit. Without this the first cleared heading still shifted the columns.
  it('with nothing recorded, the baseline is the stored columns\' own headings', () => {
    const legacy = {
      settings: { spreadsheetId: 's1', sheetTitle: 'Responses' },
      columns: [col('A'), col('B'), col('C')],
    };
    expect(writtenSheetHeaders(legacy)).toBeNull();
    expect(sheetBaselineHeaders(legacy)).toEqual(['A', 'B', 'C']);
    // What was recorded wins over the columns when there is something recorded.
    expect(
      sheetBaselineHeaders({ ...legacy, settings: { ...legacy.settings, headerSnapshot: snapshot } }),
    ).toEqual(['A', 'B']);
    // No spreadsheet, no baseline.
    expect(sheetBaselineHeaders({ settings: {}, columns: [col('A')] })).toBeNull();
    expect(sheetBaselineHeaders(undefined)).toBeNull();
  });

  it('is null for another spreadsheet, another tab, or none recorded', () => {
    expect(
      writtenSheetHeaders({ settings: { spreadsheetId: 's2', sheetTitle: 'Responses', headerSnapshot: snapshot } }),
    ).toBeNull();
    expect(writtenSheetHeaders({ settings: { spreadsheetId: 's1', sheetTitle: 'Other', headerSnapshot: snapshot } })).toBeNull();
    expect(writtenSheetHeaders({ settings: { spreadsheetId: 's1', sheetTitle: 'Responses' } })).toBeNull();
    expect(writtenSheetHeaders(undefined)).toBeNull();
  });
});
