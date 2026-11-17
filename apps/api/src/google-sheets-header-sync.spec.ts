/**
 * Keeping a spreadsheet's header row in line with the form's columns.
 *
 * The bug this exists for: an author added a column titled "booking" and
 * renamed two others, and row 1 of their sheet kept the old headings, because
 * the only writer there was wrote into an EMPTY row 1 and nothing else. That
 * rule was deliberate and it stays the floor: a row 1 that holds anything
 * dForms did not write is someone's data and is never touched. What changes is
 * that a row 1 dForms can prove it wrote (every occupied cell equals a heading
 * dForms put at that position) may now be rewritten.
 */
import { describe, expect, it, vi } from 'vitest';
import { ownsHeaderRow, syncHeaderRow } from './google-sheets-api';

/** A queue of answers, consumed in order: a read, then maybe a write. */
function sheet(row: unknown[] | null, writeStatus = 200) {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (method === 'GET') {
      return { ok: true, status: 200, json: async () => (row ? { values: [row] } : {}) };
    }
    return { ok: writeStatus < 300, status: writeStatus, json: async () => ({}) };
  }) as unknown as typeof fetch;
  const writes = () => calls.filter((c) => c.method === 'PUT');
  return { fetchImpl, calls, writes };
}

const OLD = ['Submitted', 'Email', 'Company'];

describe('a row 1 dForms wrote follows the columns', () => {
  it('extends row 1 when a column is added at the end (the "booking" case)', async () => {
    const s = sheet(OLD);
    await expect(
      syncHeaderRow('tok', 'sheet-1', 'Responses', [...OLD, 'booking'], [OLD], s.fetchImpl),
    ).resolves.toEqual({ ok: true, outcome: 'written' });
    expect(s.writes()).toHaveLength(1);
    expect(s.writes()[0]!.body).toEqual({ values: [['Submitted', 'Email', 'Company', 'booking']] });
    expect(decodeURIComponent(s.writes()[0]!.url)).toContain("'Responses'!A1:D1");
  });

  it('rewrites renamed headings in place', async () => {
    const s = sheet(OLD);
    await syncHeaderRow('tok', 'sheet-1', 'Responses', ['Submitted', 'Work email', 'Org'], [OLD], s.fetchImpl);
    expect(s.writes()[0]!.body).toEqual({ values: [['Submitted', 'Work email', 'Org']] });
  });

  it('clears the heading of a removed column instead of leaving it behind', async () => {
    const s = sheet(OLD);
    await syncHeaderRow('tok', 'sheet-1', 'Responses', ['Submitted', 'Email'], [OLD], s.fetchImpl);
    // Spans the OLD width, so column C is blanked rather than left saying "Company".
    expect(s.writes()[0]!.body).toEqual({ values: [['Submitted', 'Email', '']] });
    expect(decodeURIComponent(s.writes()[0]!.url)).toContain('A1:C1');
  });

  it('rewrites the row in the new order when columns are reordered', async () => {
    const s = sheet(OLD);
    await syncHeaderRow('tok', 'sheet-1', 'Responses', ['Email', 'Submitted', 'Company'], [OLD], s.fetchImpl);
    expect(s.writes()[0]!.body).toEqual({ values: [['Email', 'Submitted', 'Company']] });
  });

  it('writes into an empty row 1 with no history at all', async () => {
    const s = sheet(null);
    await expect(
      syncHeaderRow('tok', 'sheet-1', 'Responses', OLD, [], s.fetchImpl),
    ).resolves.toEqual({ ok: true, outcome: 'written' });
    expect(s.writes()[0]!.body).toEqual({ values: [OLD] });
  });

  it('only fills the blanks when row 1 is a shorter copy of the new headings', async () => {
    // No snapshot (a sheet created before they existed) and row 1 is the first
    // two of the new headings: writing changes nothing that is there.
    const s = sheet(['Submitted', 'Email']);
    await expect(
      syncHeaderRow('tok', 'sheet-1', 'Responses', OLD, [], s.fetchImpl),
    ).resolves.toEqual({ ok: true, outcome: 'written' });
  });

  it('makes no write when row 1 already reads the headings', async () => {
    const s = sheet([...OLD, '', ' ']);
    await expect(
      syncHeaderRow('tok', 'sheet-1', 'Responses', OLD, [], s.fetchImpl),
    ).resolves.toEqual({ ok: true, outcome: 'unchanged' });
    expect(s.writes()).toHaveLength(0);
  });

  it('reads the WHOLE of row 1, so a heading past ours is seen', async () => {
    const s = sheet(OLD);
    await syncHeaderRow('tok', 'sheet-1', "Ana's notes", OLD, [OLD], s.fetchImpl);
    expect(decodeURIComponent(s.calls[0]!.url)).toContain("'Ana''s notes'!1:1");
  });

  it('writes RAW, so a heading that begins with = stays text', async () => {
    const s = sheet(null);
    await syncHeaderRow('tok', 'sheet-1', 'Responses', ['=total'], [], s.fetchImpl);
    expect(new URL(s.writes()[0]!.url).searchParams.get('valueInputOption')).toBe('RAW');
  });
});

describe('SAFETY: a row 1 with foreign data is never overwritten', () => {
  it('leaves a row of somebody else’s data alone, with no write at all', async () => {
    const s = sheet(['2025-01-03', 'ana@example.com', 'Acme']);
    await expect(
      syncHeaderRow('tok', 'sheet-1', 'Responses', [...OLD, 'booking'], [OLD], s.fetchImpl),
    ).resolves.toMatchObject({ ok: true, outcome: 'foreign' });
    expect(s.writes()).toHaveLength(0);
  });

  it('leaves it alone when the author typed a heading of their own past ours', async () => {
    const s = sheet([...OLD, 'Notes']);
    await expect(
      syncHeaderRow('tok', 'sheet-1', 'Responses', [...OLD, 'booking'], [OLD], s.fetchImpl),
    ).resolves.toMatchObject({ ok: true, outcome: 'foreign' });
    expect(s.writes()).toHaveLength(0);
  });

  it('leaves it alone when one heading was edited by hand in the sheet', async () => {
    const s = sheet(['Submitted', 'E-mail address', 'Company']);
    await expect(
      syncHeaderRow('tok', 'sheet-1', 'Responses', [...OLD, 'booking'], [OLD], s.fetchImpl),
    ).resolves.toMatchObject({ ok: true, outcome: 'foreign' });
    expect(s.writes()).toHaveLength(0);
  });

  it('does not count the same names in another order as ours', async () => {
    const s = sheet(['Email', 'Submitted', 'Company']);
    await expect(
      syncHeaderRow('tok', 'sheet-1', 'Responses', [...OLD, 'booking'], [OLD], s.fetchImpl),
    ).resolves.toMatchObject({ ok: true, outcome: 'foreign' });
    expect(s.writes()).toHaveLength(0);
  });
});

describe('the author can replace a row 1 that does not match, on purpose', () => {
  it('reports what row 1 holds, so it can be compared before anything is replaced', async () => {
    const s = sheet(['Submitted', 'E-mail address', 'Company', '', '']);
    await expect(
      syncHeaderRow('tok', 'sheet-1', 'Responses', ['Submitted', 'Work email', 'Org'], [], s.fetchImpl),
    ).resolves.toEqual({
      ok: true,
      outcome: 'foreign',
      current: ['Submitted', 'E-mail address', 'Company'],
    });
  });

  it('overwrites it only when asked with `replace`', async () => {
    const s = sheet(['Submitted', 'E-mail address', 'Company', 'Notes']);
    await expect(
      syncHeaderRow('tok', 'sheet-1', 'Responses', ['Submitted', 'Work email'], [], s.fetchImpl, undefined, {
        replace: true,
      }),
    ).resolves.toEqual({ ok: true, outcome: 'written' });
    // The old width is blanked past the new headings, like any other rewrite.
    expect(s.writes()[0]!.body).toEqual({ values: [['Submitted', 'Work email', '', '']] });
  });
});

describe('failures are reported, never mistaken for a write', () => {
  it('says why when Google refuses the read', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 403, json: async () => ({}) })) as unknown as typeof fetch;
    await expect(syncHeaderRow('tok', 's', 'T', OLD, [], fetchImpl)).resolves.toEqual({
      ok: false,
      reason: 'forbidden',
    });
  });

  it('says why when the write itself is refused', async () => {
    const s = sheet(null, 404);
    await expect(syncHeaderRow('tok', 's', 'T', OLD, [], s.fetchImpl)).resolves.toEqual({
      ok: false,
      reason: 'not_found',
    });
  });

  it('is unavailable rather than throwing when nothing answers', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('socket hang up');
    }) as unknown as typeof fetch;
    await expect(syncHeaderRow('tok', 's', 'T', OLD, [], fetchImpl)).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
    });
  });
});

describe('ownsHeaderRow', () => {
  it('owns an empty row and a prefix, and nothing that differs at a position', () => {
    expect(ownsHeaderRow([], OLD)).toBe(true);
    expect(ownsHeaderRow(['Submitted', '', 'Company'], OLD)).toBe(true);
    expect(ownsHeaderRow(['Submitted'], OLD)).toBe(true);
    expect(ownsHeaderRow([...OLD, 'x'], OLD)).toBe(false);
    expect(ownsHeaderRow(['Email'], OLD)).toBe(false);
  });
});
