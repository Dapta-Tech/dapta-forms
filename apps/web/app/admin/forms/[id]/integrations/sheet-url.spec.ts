/** The link back to a spreadsheet from the editor. */
import { describe, expect, it } from 'vitest';
import { sheetUrlFor } from './sheet-url';

const ID = '1QxYz-exampleSpreadsheetId_0123456789';

describe('sheetUrlFor', () => {
  it('builds a link back to the spreadsheet', () => {
    expect(sheetUrlFor(ID)).toBe(`https://docs.google.com/spreadsheets/d/${ID}/edit`);
    expect(sheetUrlFor(ID, 814)).toBe(`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=814`);
  });

  it('escapes an id rather than letting it steer the address', () => {
    expect(sheetUrlFor('a/b?c')).toBe('https://docs.google.com/spreadsheets/d/a%2Fb%3Fc/edit');
  });
});
