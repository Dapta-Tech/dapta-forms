/**
 * Reading a spreadsheet out of what the author actually pastes, which is never
 * an id and is usually whatever their address bar held.
 */
import { describe, expect, it } from 'vitest';
import { parseSheetUrl, sheetUrlFor } from './sheet-url';

const ID = '1QxYz-exampleSpreadsheetId_0123456789';

describe('parseSheetUrl', () => {
  it('reads the id out of the address bar', () => {
    expect(parseSheetUrl(`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=0`)).toEqual({
      spreadsheetId: ID,
      gid: 0,
    });
  });

  it('keeps the tab the link points at', () => {
    expect(
      parseSheetUrl(`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=814`)?.gid,
    ).toBe(814);
  });

  it('survives the shapes a share dialog and a multi-account session produce', () => {
    for (const url of [
      `https://docs.google.com/spreadsheets/d/${ID}/edit?usp=sharing`,
      `https://docs.google.com/spreadsheets/d/${ID}`,
      `https://docs.google.com/spreadsheets/u/2/d/${ID}/edit`,
      `  https://docs.google.com/spreadsheets/d/${ID}/edit  `,
    ]) {
      expect(parseSheetUrl(url)?.spreadsheetId, url).toBe(ID);
    }
  });

  it('accepts a bare id, which is what a copied config holds', () => {
    expect(parseSheetUrl(ID)).toEqual({ spreadsheetId: ID, gid: null });
  });

  it('refuses another kind of Google link rather than mining it for an id', () => {
    // A Doc and a Drive folder both carry an id-shaped path segment. Reading
    // one would store a destination that looks configured and fails on its
    // first delivery.
    expect(parseSheetUrl(`https://docs.google.com/document/d/${ID}/edit`)).toBeNull();
    expect(parseSheetUrl(`https://drive.google.com/drive/folders/${ID}`)).toBeNull();
  });

  it('refuses junk, a half-paste and an empty field', () => {
    for (const value of ['', '   ', 'https://', 'my sheet', 'docs.google.com/spreadsheets', 'short']) {
      expect(parseSheetUrl(value), value).toBeNull();
    }
  });

  it('ignores a gid that is not a number', () => {
    expect(parseSheetUrl(`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=abc`)?.gid).toBeNull();
  });
});

describe('sheetUrlFor', () => {
  it('builds a link back to the spreadsheet', () => {
    expect(sheetUrlFor(ID)).toBe(`https://docs.google.com/spreadsheets/d/${ID}/edit`);
    expect(sheetUrlFor(ID, 814)).toBe(`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=814`);
  });

  it('round-trips with the parser', () => {
    expect(parseSheetUrl(sheetUrlFor(ID, 7))).toEqual({ spreadsheetId: ID, gid: 7 });
  });
});
