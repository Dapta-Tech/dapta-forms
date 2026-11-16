/**
 * What survives a save from the Connect tab.
 *
 * The tab assembles the whole `destinations` array from the cards it renders,
 * and autosave rewrites that array on any edit. So every destination has to
 * leave by one of exactly two doors, and a kind that leaves by neither is
 * DELETED: silently, with nothing on screen to hint at it, and a save reporting
 * success.
 *
 *   edited   the screen has a card for it, so it is rebuilt from that card.
 *            Webhook, HubSpot, and now Google Sheets.
 *   carried  the screen has no card, so the stored value rides along untouched.
 *
 * Google Sheets moved from the second door to the first when the mapping editor
 * landed, which is why these specs assert both halves: `carriedOthers` must no
 * longer carry it (or a save would store it twice, once rebuilt and once
 * carried), and the editing path must round-trip it.
 */
import { describe, expect, it } from 'vitest';
import type { FormDestination } from '@quill/types';
import {
  builtGoogleSheets,
  carriedOthers,
  carriedWebhooks,
  initialGoogleSheets,
  showsGoogleSheetsCard,
} from './integrations-editor';

const hook = (url: string): FormDestination =>
  ({ type: 'webhook', enabled: true, settings: { url } }) as unknown as FormDestination;

const hubspot = (): FormDestination =>
  ({ type: 'hubspot', enabled: true, settings: {} }) as unknown as FormDestination;

const sheets = (spreadsheetId = 'sheet-1'): FormDestination =>
  ({
    type: 'google-sheets',
    enabled: true,
    settings: { spreadsheetId, sheetTitle: 'Responses' },
    columns: [{ header: 'Email', source: 'answer', key: 'email' }],
  }) as unknown as FormDestination;

describe('carriedOthers', () => {
  it('does NOT carry Google Sheets, which the screen now edits', () => {
    // Carrying it as well as rebuilding it would store the destination twice,
    // and every submission would be appended to the spreadsheet twice with it.
    expect(carriedOthers([hook('https://a.test/h'), sheets(), hubspot()])).toEqual([]);
  });

  it('carries a kind nobody has written yet, which is the point of the rule', () => {
    const future = { type: 'something-new', enabled: true } as unknown as FormDestination;
    expect(carriedOthers([hubspot(), future])).toEqual([future]);
  });

  it('carries nothing when every destination has a card', () => {
    expect(carriedOthers([hook('https://a.test/h'), hubspot(), sheets()])).toEqual([]);
    expect(carriedOthers([])).toEqual([]);
  });

  it('never double-counts a webhook, which has its own carry rule', () => {
    const destinations = [hook('https://a.test/h'), hook('https://b.test/h'), hubspot()];
    const others = carriedOthers(destinations);
    const webhooks = carriedWebhooks(destinations);
    expect(others.some((d) => webhooks.includes(d))).toBe(false);
  });
});

describe('a stored spreadsheet destination round-trips through the card', () => {
  it('comes back out of a save unchanged', () => {
    // The real guarantee: open the tab, touch something unrelated, and the
    // spreadsheet sync is still exactly what it was.
    expect(builtGoogleSheets(initialGoogleSheets([sheets()]))).toEqual(sheets());
  });

  it('keeps a destination that was switched off', () => {
    const off = { ...(sheets() as Record<string, unknown>), enabled: false } as FormDestination;
    expect(builtGoogleSheets(initialGoogleSheets([off]))).toEqual(off);
  });

  it('reads the stored spreadsheet and its tab back into the card', () => {
    const state = initialGoogleSheets([sheets('abc123')]);
    expect(state.spreadsheetId).toBe('abc123');
    expect(state.sheetTitle).toBe('Responses');
  });

  it('starts empty, and stores nothing, for a form with no spreadsheet', () => {
    const state = initialGoogleSheets([hubspot()]);
    expect(state).toEqual({
      enabled: false,
      spreadsheetId: '',
      sheetTitle: '',
      columns: [],
    });
    expect(builtGoogleSheets(state)).toBeNull();
  });

  it('stores nothing while the card is incomplete', () => {
    // Either half missing means every delivery would degrade to a no-op, which
    // the author would only discover in a history full of them.
    const noSheet = { ...initialGoogleSheets([sheets()]), spreadsheetId: '' };
    expect(builtGoogleSheets(noSheet)).toBeNull();
    const noColumns = { ...initialGoogleSheets([sheets()]), columns: [] };
    expect(builtGoogleSheets(noColumns)).toBeNull();
  });

  it('drops a half-typed column instead of refusing the save', () => {
    // The tab autosaves, so a half-typed row exists on the way to every
    // complete one. Refusing would mean an author cannot add a column without
    // the screen complaining at them mid-keystroke.
    const state = {
      ...initialGoogleSheets([sheets()]),
      columns: [
        { header: 'Email', source: 'answer' as const, key: 'email' },
        { header: '', source: 'answer' as const, key: 'company' },
        { header: 'No question picked', source: 'answer' as const },
      ],
    };
    expect(builtGoogleSheets(state)).toMatchObject({
      columns: [{ header: 'Email', source: 'answer', key: 'email' }],
    });
  });

  it('leaves the tab out when none was chosen, so the first tab is used', () => {
    const state = { ...initialGoogleSheets([sheets()]), sheetTitle: '' };
    const built = builtGoogleSheets(state) as { settings: Record<string, unknown> };
    expect(built.settings).toEqual({ spreadsheetId: 'sheet-1' });
  });
});

describe('the spreadsheet card on a deployment that cannot connect Google', () => {
  it('is left out of a form with no spreadsheet destination', () => {
    expect(showsGoogleSheetsCard(false, [hook('https://a.test'), hubspot()])).toBe(false);
    expect(showsGoogleSheetsCard(false, [])).toBe(false);
  });

  it('stays on a form that already stores one, so it can be switched off', () => {
    expect(showsGoogleSheetsCard(false, [hubspot(), sheets()])).toBe(true);
  });

  it('is shown wherever Google can be connected, stored destination or not', () => {
    expect(showsGoogleSheetsCard(true, [])).toBe(true);
    expect(showsGoogleSheetsCard(true, [sheets()])).toBe(true);
  });

  it('does not decide what a save stores: a hidden card still writes its destination back', () => {
    const stored = [sheets()];
    expect(showsGoogleSheetsCard(false, [])).toBe(false);
    expect(builtGoogleSheets(initialGoogleSheets(stored))).toMatchObject({
      type: 'google-sheets',
      settings: { spreadsheetId: 'sheet-1' },
    });
  });
});
