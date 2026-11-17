/**
 * Nothing the save pill calls saved may be lost on a reload.
 *
 * Two ways it was, both on the Google Sheets card:
 *  1. a new column with only a heading, or only an answer, was dropped from
 *     what was sent, so it vanished on reload while the pill said "saved";
 *  2. the card switched on with no spreadsheet stored nothing at all
 *     (`destinations: []`), so the switch was off again after a reload.
 *
 * A reload is the stored config read back: what the card sends, parsed by the
 * same schema the API validates the write with, then read by the card again.
 * The test is that the card comes back exactly as it was left.
 */
import { describe, expect, it } from 'vitest';
import { destinationIsDeliverable, formDestinationSchema, type FormDestination } from '@quill/types';
import { builtGoogleSheets, initialGoogleSheets } from './integrations-editor';
import type { GoogleSheetsState } from './google-sheets-card';

/** Save (through the API's own schema), then reload. */
function reload(state: GoogleSheetsState): GoogleSheetsState {
  const sent = builtGoogleSheets(state);
  const stored = sent ? [formDestinationSchema.parse(JSON.parse(JSON.stringify(sent)))] : [];
  return initialGoogleSheets(stored as FormDestination[]);
}

const SHEET: GoogleSheetsState = {
  enabled: true,
  spreadsheetId: 'sheet-1',
  sheetTitle: 'Responses',
  columns: [{ header: 'Email', source: 'answer', key: 'email' }],
};

describe('a reload brings back everything the pill called saved', () => {
  it('keeps a new column that has only a heading', () => {
    const state = { ...SHEET, columns: [...SHEET.columns, { header: 'booking', source: 'answer' as const }] };
    expect(reload(state)).toEqual(state);
  });

  it('keeps a new column that has only an answer', () => {
    const state = {
      ...SHEET,
      columns: [...SHEET.columns, { header: '', source: 'answer' as const, key: 'company' }],
    };
    expect(reload(state)).toEqual(state);
  });

  it('keeps the switch on with no spreadsheet chosen yet', () => {
    const state: GoogleSheetsState = { enabled: true, spreadsheetId: '', sheetTitle: '', columns: [] };
    expect(reload(state)).toEqual(state);
  });

  it('still stores nothing for a card nobody touched', () => {
    const state: GoogleSheetsState = { enabled: false, spreadsheetId: '', sheetTitle: '', columns: [] };
    expect(builtGoogleSheets(state)).toBeNull();
    expect(reload(state)).toEqual(state);
  });
});

describe('what is stored mid-setup is never delivered to', () => {
  it('skips a destination with no spreadsheet, or with no named column', () => {
    const noSheet = builtGoogleSheets({ enabled: true, spreadsheetId: '', sheetTitle: '', columns: SHEET.columns })!;
    expect(destinationIsDeliverable(noSheet)).toBe(false);
    const onlyUnnamed = builtGoogleSheets({ ...SHEET, columns: [{ header: '', source: 'answer', key: 'email' }] })!;
    expect(destinationIsDeliverable(onlyUnnamed)).toBe(false);
    // A heading with no answer yet is a column of the sheet: deliverable.
    const headingOnly = builtGoogleSheets({ ...SHEET, columns: [{ header: 'booking', source: 'answer' }] })!;
    expect(destinationIsDeliverable(headingOnly)).toBe(true);
    expect(destinationIsDeliverable(builtGoogleSheets(SHEET)!)).toBe(true);
  });
});
