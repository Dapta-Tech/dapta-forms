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
import { sheetCells, writableSheetColumns, writtenSheetHeaders } from './index';

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

  it('holds nothing when the named columns no longer line up (a reorder, a rename in place)', () => {
    expect(shape(sheetCells([col('C'), col('', 'b'), col('A')], written))).toEqual(['C', 'A']);
    expect(shape(sheetCells([col('A'), col('', 'b'), col('Z')], written))).toEqual(['A', 'Z']);
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

  it('is null for another spreadsheet, another tab, or none recorded', () => {
    expect(
      writtenSheetHeaders({ settings: { spreadsheetId: 's2', sheetTitle: 'Responses', headerSnapshot: snapshot } }),
    ).toBeNull();
    expect(writtenSheetHeaders({ settings: { spreadsheetId: 's1', sheetTitle: 'Other', headerSnapshot: snapshot } })).toBeNull();
    expect(writtenSheetHeaders({ settings: { spreadsheetId: 's1', sheetTitle: 'Responses' } })).toBeNull();
    expect(writtenSheetHeaders(undefined)).toBeNull();
  });
});
