/**
 * The two Sheets calls the ADMIN makes: listing a spreadsheet's tabs, and
 * writing the header row once.
 *
 * The header row is the one with a real safety property, and it is the reason
 * the call is here rather than in the delivery path: it READS row 1 and writes
 * only into an empty one. An author who points dForms at a spreadsheet that
 * already holds a year of data would otherwise have its first row of real
 * submissions replaced by column titles, and a spreadsheet does not remember
 * what used to be in a cell.
 */
import { describe, expect, it, vi } from 'vitest';
import { columnLetter, listSheetTabs, writeHeaderRow } from './google-sheets-api';

/** A queue of answers, consumed in order (the header row makes two calls). */
function responses(...queued: Array<{ status: number; body?: unknown }>) {
  const calls: Array<[string, RequestInit | undefined]> = [];
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push([url, init]);
    const next = queued.shift() ?? { status: 500 };
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      json: async () => next.body ?? null,
    };
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const META = {
  properties: { title: 'Leads' },
  sheets: [
    { properties: { title: 'Responses', sheetId: 0 } },
    { properties: { title: "Ana's notes", sheetId: 814 } },
  ],
};

describe('columnLetter', () => {
  it('counts past Z, so a 30-question form does not build a broken range', () => {
    expect(columnLetter(1)).toBe('A');
    expect(columnLetter(26)).toBe('Z');
    expect(columnLetter(27)).toBe('AA');
    expect(columnLetter(30)).toBe('AD');
    expect(columnLetter(52)).toBe('AZ');
    expect(columnLetter(53)).toBe('BA');
  });
});

describe('listSheetTabs', () => {
  it('returns the document name and its tabs with their gids', async () => {
    const { fetchImpl } = responses({ status: 200, body: META });
    await expect(listSheetTabs('tok', 'sheet-1', fetchImpl)).resolves.toEqual({
      ok: true,
      spreadsheetTitle: 'Leads',
      tabs: [
        { title: 'Responses', gid: 0 },
        { title: "Ana's notes", gid: 814 },
      ],
    });
  });

  it('asks for only the fields the picker needs, not the whole document', async () => {
    // Without `fields`, Google returns every cell. For a sheet with a year of
    // submissions that is megabytes travelling so a dropdown can show 3 names.
    const { fetchImpl, calls } = responses({ status: 200, body: META });
    await listSheetTabs('tok', 'sheet-1', fetchImpl);
    const url = new URL(calls[0]![0]);
    expect(url.searchParams.get('fields')).toBe('properties.title,sheets.properties(title,sheetId)');
  });

  it('tells "no such spreadsheet" apart from "you cannot open it"', async () => {
    // Two different places to send the author; collapsing them starts a support
    // thread.
    const missing = responses({ status: 404 });
    await expect(listSheetTabs('tok', 'gone', missing.fetchImpl)).resolves.toEqual({
      ok: false,
      reason: 'not_found',
    });
    const denied = responses({ status: 403 });
    await expect(listSheetTabs('tok', 'theirs', denied.fetchImpl)).resolves.toEqual({
      ok: false,
      reason: 'forbidden',
    });
  });

  it('is unavailable rather than throwing when nothing answers', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNRESET');
    }) as unknown as typeof fetch;
    await expect(listSheetTabs('tok', 'sheet-1', fetchImpl)).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
    });
  });

  it('skips a malformed tab rather than failing the whole list', async () => {
    const { fetchImpl } = responses({
      status: 200,
      body: { properties: {}, sheets: [{ properties: { title: 'Ok', sheetId: 3 } }, { properties: {} }] },
    });
    const res = await listSheetTabs('tok', 'sheet-1', fetchImpl);
    expect(res).toEqual({ ok: true, spreadsheetTitle: '', tabs: [{ title: 'Ok', gid: 3 }] });
  });
});

describe('writeHeaderRow', () => {
  it('writes into an empty row 1', async () => {
    const { fetchImpl, calls } = responses({ status: 200, body: {} }, { status: 200, body: {} });
    await expect(
      writeHeaderRow('tok', 'sheet-1', 'Responses', ['Submitted', 'Email'], fetchImpl),
    ).resolves.toEqual({ ok: true, written: true });
    // Reads first, then writes.
    expect(calls).toHaveLength(2);
    expect(calls[0]![1]?.method ?? 'GET').toBe('GET');
    expect(calls[1]![1]?.method).toBe('PUT');
    expect(String(calls[1]![1]?.body)).toContain('Submitted');
  });

  it('refuses to overwrite a row 1 that holds anything', async () => {
    const { fetchImpl, calls } = responses({ status: 200, body: { values: [['Name', 'Email']] } });
    await expect(
      writeHeaderRow('tok', 'sheet-1', 'Responses', ['Submitted', 'Email'], fetchImpl),
    ).resolves.toEqual({ ok: true, written: false, reason: 'not_empty' });
    // And nothing was written: the read is the whole safety property.
    expect(calls).toHaveLength(1);
  });

  it('treats a row of blanks as empty, because that is what the author sees', async () => {
    const { fetchImpl } = responses(
      { status: 200, body: { values: [['', '  ']] } },
      { status: 200, body: {} },
    );
    await expect(
      writeHeaderRow('tok', 'sheet-1', 'Responses', ['Submitted'], fetchImpl),
    ).resolves.toEqual({ ok: true, written: true });
  });

  it('quotes a tab name with a quote in it', async () => {
    const { fetchImpl, calls } = responses({ status: 200, body: {} }, { status: 200, body: {} });
    await writeHeaderRow('tok', 'sheet-1', "Ana's notes", ['A'], fetchImpl);
    expect(decodeURIComponent(calls[0]![0])).toContain("'Ana''s notes'!A1:A1");
  });

  it('spans past Z for a long form', async () => {
    const { fetchImpl, calls } = responses({ status: 200, body: {} }, { status: 200, body: {} });
    const headers = Array.from({ length: 30 }, (_, i) => `H${i}`);
    await writeHeaderRow('tok', 'sheet-1', 'Responses', headers, fetchImpl);
    expect(decodeURIComponent(calls[0]![0])).toContain('A1:AD1');
  });

  it('writes RAW, so a header beginning with = stays a column title', async () => {
    const { fetchImpl, calls } = responses({ status: 200, body: {} }, { status: 200, body: {} });
    await writeHeaderRow('tok', 'sheet-1', 'Responses', ['=total'], fetchImpl);
    expect(new URL(calls[1]![0]).searchParams.get('valueInputOption')).toBe('RAW');
  });

  it('reports why it could not, rather than pretending it wrote', async () => {
    const denied = responses({ status: 403 });
    await expect(writeHeaderRow('tok', 's', 'T', ['A'], denied.fetchImpl)).resolves.toEqual({
      ok: false,
      reason: 'forbidden',
    });
    const missing = responses({ status: 404 });
    await expect(writeHeaderRow('tok', 's', 'T', ['A'], missing.fetchImpl)).resolves.toEqual({
      ok: false,
      reason: 'not_found',
    });
  });

  it('does nothing at all without headers', async () => {
    const { fetchImpl, calls } = responses();
    await expect(writeHeaderRow('tok', 'sheet-1', 'Responses', [], fetchImpl)).resolves.toEqual({
      ok: true,
      written: false,
      reason: 'not_empty',
    });
    expect(calls).toHaveLength(0);
  });
});
