/**
 * The header row follows the saved columns, and the API alone decides what
 * dForms "wrote".
 *
 * Reproduced in production: a column titled "booking" was added and two were
 * renamed, autosave stored them, and row 1 of the spreadsheet kept the old
 * headings. Pressing the header button did nothing either, because the only
 * writer refused any row 1 that was not empty.
 *
 * What these pin, through the real controller:
 *   - a save that changes the headings rewrites a row 1 dForms wrote;
 *   - a row 1 holding anything else is never written, on any path;
 *   - `headerSnapshot` comes from the stored row and the Sheets result, never
 *     from the request, so a client cannot claim a row 1 it never wrote;
 *   - a save that does not change the headings costs Google nothing.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, getAccountByCode, getFormById, listForms, migrate, seed, updateForm, type Db } from '@quill/db';
import type { ServerEnv } from '@quill/config/env';
import { FormDestinationsController } from './integrations.controller';
import { ApiMcpBackend } from './mcp.backend.parity';
import { AuthService } from './auth.service';
import { LocalAuthProvider, type ReqLike } from './auth.provider';
import type { GoogleSheetsAccessTokens } from './google-sheets-token';

const asOwner = (): ReqLike => ({ headers: {} });
const SHEET = 'sheet-abc';
const OLD = ['Submitted', 'Email', 'Company'];

let db: Db;
let controller: FormDestinationsController;
let accountId: string;
let formId: string;
/** Row 1 of the fake spreadsheet, as Google would report it. */
let row1: string[];
let reads: number;
let writes: unknown[][];

/** A spreadsheet whose row 1 is `row1`, and which applies the writes it gets. */
const sheetsFetch = (async (_url: string, init?: RequestInit) => {
  if ((init?.method ?? 'GET') === 'GET') {
    reads += 1;
    return new Response(JSON.stringify(row1.length ? { values: [row1] } : {}), { status: 200 });
  }
  const values = (JSON.parse(String(init!.body)) as { values: string[][] }).values[0]!;
  writes.push(values);
  row1 = [...values];
  while (row1.length && row1[row1.length - 1] === '') row1.pop();
  return new Response('{}', { status: 200 });
}) as unknown as typeof fetch;

const column = (header: string, key?: string) =>
  key ? { header, source: 'answer', key } : { header, source: 'submitted_at' };

/** The spreadsheet destination as the Connect tab sends it. */
function fromEditor(headers: string[], settings: Record<string, unknown> = {}) {
  return {
    type: 'google-sheets',
    enabled: true,
    settings: { spreadsheetId: SHEET, sheetTitle: 'Responses', ...settings },
    columns: headers.map((h, i) => (i === 0 ? column(h) : column(h, `q${i}`))),
  };
}

async function store(destination: Record<string, unknown>): Promise<void> {
  await updateForm(db, accountId, formId, {
    config: { version: 1, steps: [], destinations: [destination] },
  });
}

async function storedSnapshot(): Promise<unknown> {
  const form = await getFormById(db, accountId, formId);
  const list = (form!.config as { destinations?: Record<string, unknown>[] }).destinations ?? [];
  const entry = list.find((d) => d.type === 'google-sheets');
  return (entry?.settings as Record<string, unknown> | undefined)?.headerSnapshot;
}

beforeEach(async () => {
  db = await createDb('file::memory:');
  await migrate(db);
  await seed(db);
  accountId = (await getAccountByCode(db, 'acme'))!.id;
  formId = (await listForms(db, accountId)).find((f) => f.slug === 'lead-qualifier')!.id;
  row1 = [...OLD];
  reads = 0;
  writes = [];
  const provider = new LocalAuthProvider(db, {
    NODE_ENV: 'test',
    DEV_LOGIN_EMAIL: undefined,
    AUTH_LOCAL_STRICT: undefined,
    SEED_DEMO_FORM: false,
    ONBOARDING_WIZARD: false,
  });
  const tokens = { resolve: async () => 'tok' } as unknown as GoogleSheetsAccessTokens;
  controller = new FormDestinationsController(
    db,
    new AuthService(db, provider),
    { NODE_ENV: 'test' } as unknown as ServerEnv,
    undefined,
    tokens,
  );
  controller.fetchImpl = sheetsFetch;
});

afterEach(async () => {
  await db.close();
});

describe('saving new columns updates the header row dForms wrote', () => {
  it('with no snapshot recorded, a row 1 exactly equal to the stored columns follows the configuration without a confirm (even one typed by hand): "booking" is added', async () => {
    // Stored before snapshots existed, so nothing says who wrote row 1: the
    // create call, or the author by hand in a sheet they picked. dForms
    // cannot tell the two apart and treats both the same: a row 1 equal to
    // the stored columns is the columns' own header row, and an edit to the
    // columns rewrites it. This is the intended rule, not a gap (see the
    // comment at `owned` in `syncSheetHeaders`).
    await store(fromEditor(OLD));
    expect(await storedSnapshot()).toBeUndefined();
    const out = await controller.putDestinations(asOwner(), formId, {
      destinations: [fromEditor([...OLD, 'booking'])],
    });
    expect(writes).toEqual([[...OLD, 'booking']]);
    expect((out as { sheetHeaders?: unknown }).sheetHeaders).toEqual({ outcome: 'written' });
    expect(await storedSnapshot()).toEqual({
      spreadsheetId: SHEET,
      sheetTitle: 'Responses',
      headers: [...OLD, 'booking'],
    });
  });

  it('keeps following edit after edit, from its own snapshot', async () => {
    await store(fromEditor(OLD));
    await controller.putDestinations(asOwner(), formId, { destinations: [fromEditor([...OLD, 'booking'])] });
    await controller.putDestinations(asOwner(), formId, {
      destinations: [fromEditor(['Submitted', 'Work email', 'booking'])],
    });
    expect(row1).toEqual(['Submitted', 'Work email', 'booking']);
  });

  it('asks Google nothing when a save leaves headings that are known to be in row 1', async () => {
    await store({
      ...fromEditor(OLD),
      settings: {
        spreadsheetId: SHEET,
        sheetTitle: 'Responses',
        headerSnapshot: { spreadsheetId: SHEET, sheetTitle: 'Responses', headers: OLD },
      },
    });
    await controller.putDestinations(asOwner(), formId, {
      destinations: [{ ...fromEditor(OLD), enabled: false }],
    });
    expect(reads).toBe(0);
    expect(writes).toEqual([]);
  });
});

describe('SAFETY: a row 1 with foreign data is never overwritten', () => {
  it('leaves somebody’s data in row 1 alone on save, and says so', async () => {
    row1 = ['2025-01-03', 'ana@example.com', 'Acme'];
    await store(fromEditor(OLD));
    const out = await controller.putDestinations(asOwner(), formId, {
      destinations: [fromEditor([...OLD, 'booking'])],
    });
    expect(writes).toEqual([]);
    expect(row1).toEqual(['2025-01-03', 'ana@example.com', 'Acme']);
    expect((out as { sheetHeaders?: unknown }).sheetHeaders).toEqual({
      outcome: 'foreign',
      current: ['2025-01-03', 'ana@example.com', 'Acme'],
      headers: [...OLD, 'booking'],
    });
    // The columns are still saved: the header row is a notice, not a gate.
    const form = await getFormById(db, accountId, formId);
    expect(JSON.stringify(form!.config)).toContain('booking');
  });

  it('ignores a snapshot the CALLER sends, so it cannot claim a row it never wrote', async () => {
    row1 = ['Name', 'Phone'];
    await store(fromEditor(OLD));
    await controller.putDestinations(asOwner(), formId, {
      destinations: [
        fromEditor([...OLD, 'booking'], {
          headerSnapshot: { spreadsheetId: SHEET, sheetTitle: 'Responses', headers: ['Name', 'Phone'] },
        }),
      ],
    });
    expect(writes).toEqual([]);
    expect(row1).toEqual(['Name', 'Phone']);
    expect(await storedSnapshot()).toBeUndefined();
  });

  it('does not carry ownership over to another spreadsheet', async () => {
    await store({
      ...fromEditor(OLD),
      settings: {
        spreadsheetId: SHEET,
        sheetTitle: 'Responses',
        headerSnapshot: { spreadsheetId: SHEET, sheetTitle: 'Responses', headers: OLD },
      },
    });
    // The newly chosen spreadsheet's row 1 happens to read like the old one's.
    row1 = [...OLD];
    await controller.putDestinations(asOwner(), formId, {
      destinations: [fromEditor([...OLD, 'booking'], { spreadsheetId: 'another-sheet' })],
    });
    // Only an exact match or a prefix of the new headings is ours there: the
    // row is a prefix here, so the only cell written is the empty D1.
    expect(writes).toEqual([[...OLD, 'booking']]);
    row1 = ['Their', 'Own'];
    writes = [];
    await controller.putDestinations(asOwner(), formId, {
      destinations: [fromEditor(['Submitted', 'booking'], { spreadsheetId: 'third-sheet' })],
    });
    expect(writes).toEqual([]);
  });
});

describe('the header button', () => {
  it('syncs from the STORED columns and records what it wrote', async () => {
    // The columns were saved before this fix shipped, so row 1 still has the
    // previous headings. It is a prefix of the stored ones: the press fills D1.
    await store(fromEditor([...OLD, 'booking']));
    const first = await controller.syncFormSheetHeaders(asOwner(), formId);
    expect(first).toEqual({ ok: true, outcome: 'written' });
    expect(row1).toEqual([...OLD, 'booking']);
    expect(await storedSnapshot()).toMatchObject({ headers: [...OLD, 'booking'] });
  });

  it('refuses to touch a foreign row 1, and stores nothing', async () => {
    row1 = ['Name', 'Phone'];
    await store(fromEditor(OLD));
    await expect(controller.syncFormSheetHeaders(asOwner(), formId)).resolves.toEqual({
      ok: true,
      outcome: 'foreign',
      current: ['Name', 'Phone'],
      headers: OLD,
    });
    expect(writes).toEqual([]);
    expect(await storedSnapshot()).toBeUndefined();
  });

  it('says there is nothing to sync for a form with no spreadsheet', async () => {
    await expect(controller.syncFormSheetHeaders(asOwner(), formId)).resolves.toEqual({
      ok: false,
      reason: 'not_configured',
    });
  });
});

describe('a sheet that drifted before snapshots existed (the reported production case)', () => {
  // Row 1 still has the ORIGINAL headings; the columns were renamed in dForms
  // and autosaved before this fix shipped, so nothing proves row 1 is ours.
  const RENAMED = ['Submitted', 'Work email', 'Org', 'booking'];

  it('leaves it alone on save and on the plain button, and says what is there', async () => {
    await store(fromEditor(RENAMED));
    const plain = await controller.syncFormSheetHeaders(asOwner(), formId);
    expect(plain).toEqual({ ok: true, outcome: 'foreign', current: OLD, headers: RENAMED });
    expect(writes).toEqual([]);
  });

  it('replaces row 1 on the confirmed replace, then follows the next rename by itself', async () => {
    await store(fromEditor(RENAMED));
    // Anything but a literal `true` is the ordinary sync.
    await controller.syncFormSheetHeaders(asOwner(), formId, { replace: 'yes' });
    expect(writes).toEqual([]);

    const replaced = await controller.syncFormSheetHeaders(asOwner(), formId, { replace: true });
    expect(replaced).toEqual({ ok: true, outcome: 'written' });
    expect(row1).toEqual(RENAMED);
    expect(await storedSnapshot()).toMatchObject({ headers: RENAMED });

    // Recorded as dForms-written: an ordinary save now rewrites it with no prompt.
    const next = ['Submitted', 'Work email', 'Company name', 'booking'];
    const out = await controller.putDestinations(asOwner(), formId, { destinations: [fromEditor(next)] });
    expect((out as { sheetHeaders?: unknown }).sheetHeaders).toEqual({ outcome: 'written' });
    expect(row1).toEqual(next);
  });
});

describe('columns still being filled in', () => {
  it('are stored as sent, so a reload brings them back', async () => {
    await store(fromEditor(OLD));
    const half = {
      ...fromEditor(OLD),
      columns: [...fromEditor(OLD).columns, { header: 'booking', source: 'answer' }, { header: '', source: 'answer', key: 'q9' }],
    };
    await controller.putDestinations(asOwner(), formId, { destinations: [half] });
    const form = await getFormById(db, accountId, formId);
    const stored = (form!.config as { destinations: { columns: unknown[] }[] }).destinations[0]!.columns;
    expect(stored).toEqual(half.columns);
  });

  it('write row 1 by the one rule: a heading is a column, no heading is not', async () => {
    // A complete, B heading with no answer yet, C complete, D no heading,
    // E complete. Row 1 holds A, B, C, E in letters A to D.
    await store(fromEditor(OLD));
    const cols = [
      { header: 'A', source: 'answer', key: 'q1' },
      { header: 'B', source: 'answer' },
      { header: 'C', source: 'score' },
      { header: '', source: 'answer', key: 'q4' },
      { header: 'E', source: 'outcome' },
    ];
    row1 = [];
    await controller.putDestinations(asOwner(), formId, { destinations: [{ ...fromEditor(OLD), columns: cols }] });
    expect(row1).toEqual(['A', 'B', 'C', 'E']);
  });

  it('keeps a switched-on card with no spreadsheet, and asks Google nothing', async () => {
    await controller.putDestinations(asOwner(), formId, {
      destinations: [{ type: 'google-sheets', enabled: true, settings: {}, columns: [] }],
    });
    const form = await getFormById(db, accountId, formId);
    expect((form!.config as { destinations: unknown[] }).destinations).toEqual([
      { type: 'google-sheets', enabled: true, settings: {}, columns: [] },
    ]);
    expect(reads).toBe(0);
  });
});

describe('the check on open never undoes an edit made while Google was slow', () => {
  it('writes nothing and stores nothing, so the edit survives in the config and the sheet', async () => {
    await store(fromEditor(OLD));
    row1 = [];
    // Google reads row 1 NOW (empty) but the answer only arrives once
    // released: the worst case, an answer from before the edit.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let held = false;
    const base = controller.fetchImpl;
    controller.fetchImpl = (async (url: string, init?: RequestInit) => {
      const res = await base(url, init);
      if (!held && (init?.method ?? 'GET') === 'GET') {
        held = true;
        await gate;
      }
      return res;
    }) as unknown as typeof fetch;

    const check = controller.syncFormSheetHeaders(asOwner(), formId, { check: true });
    // Meanwhile the author renames a column and the autosave stores it (and
    // writes it to row 1, which was empty).
    const edited = ['Submitted', 'Work email', 'Company'];
    await controller.putDestinations(asOwner(), formId, { destinations: [fromEditor(edited)] });
    const writesBefore = writes.length;
    release();
    await expect(check).resolves.toMatchObject({ ok: true, outcome: 'stale' });

    // Reload: the edit is there, and the sheet still says what the edit wrote.
    const form = await getFormById(db, accountId, formId);
    const stored = (form!.config as { destinations: { columns: { header: string }[] }[] }).destinations[0]!;
    expect(stored.columns.map((c) => c.header)).toEqual(edited);
    expect(writes.length).toBe(writesBefore);
    expect(row1).toEqual(edited);
  });

  it('reports a row 1 that does not match, still without writing', async () => {
    row1 = ['Name', 'Phone'];
    await store(fromEditor(OLD));
    await expect(controller.syncFormSheetHeaders(asOwner(), formId, { check: true })).resolves.toEqual({
      ok: true,
      outcome: 'foreign',
      current: ['Name', 'Phone'],
      headers: OLD,
    });
    expect(writes).toEqual([]);
  });
});

describe('a sync that failed is not forgotten (Google down while columns were reordered)', () => {
  const REORDERED = ['Email', 'Submitted', 'Company'];
  const inSync = () => ({
    ...fromEditor(OLD),
    settings: {
      spreadsheetId: SHEET,
      sheetTitle: 'Responses',
      headerSnapshot: { spreadsheetId: SHEET, sheetTitle: 'Responses', headers: OLD },
    },
  });

  it('retries on the next save, even one that changes nothing about the columns', async () => {
    await store(inSync());
    // Google answers 503 to everything while the author reorders the columns.
    const base = controller.fetchImpl;
    controller.fetchImpl = (async () => new Response('{}', { status: 503 })) as unknown as typeof fetch;
    const failed = await controller.putDestinations(asOwner(), formId, { destinations: [fromEditor(REORDERED)] });
    expect((failed as { sheetHeaders?: unknown }).sheetHeaders).toEqual({ outcome: 'failed', reason: 'unavailable' });
    expect(row1).toEqual(OLD);

    // The card opening on the drifted sheet says so (a look, no write).
    controller.fetchImpl = base;
    const look = await controller.syncFormSheetHeaders(asOwner(), formId, { check: true });
    expect(look).toEqual({ ok: true, outcome: 'stale' });
    expect(writes).toEqual([]);

    // Google is back. A save that only flips the switch still repairs row 1:
    // what row 1 holds for these headings is not KNOWN, so it is checked.
    await controller.putDestinations(asOwner(), formId, {
      destinations: [{ ...fromEditor(REORDERED), enabled: false }],
    });
    expect(row1).toEqual(REORDERED);
    // And once known, the next unrelated save asks Google nothing.
    const readsAfter = reads;
    await controller.putDestinations(asOwner(), formId, { destinations: [fromEditor(REORDERED)] });
    expect(reads).toBe(readsAfter);
  });

  it('does not re-read a row 1 it already found is someone else\'s, on every save', async () => {
    row1 = ['Name', 'Phone'];
    await store(fromEditor(OLD));
    await controller.putDestinations(asOwner(), formId, { destinations: [fromEditor(REORDERED)] });
    const after = reads;
    await controller.putDestinations(asOwner(), formId, { destinations: [{ ...fromEditor(REORDERED), enabled: false }] });
    expect(reads).toBe(after);
    expect(row1).toEqual(['Name', 'Phone']);
  });
});

describe('a confirmed replace that races an edit', () => {
  it('reports stale, not written, when the headings changed while row 1 was being written', async () => {
    row1 = ['Name', 'Phone'];
    await store(fromEditor(OLD));
    // Hold the replace's WRITE until the author's rename has been stored.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let held = false;
    const base = controller.fetchImpl;
    controller.fetchImpl = (async (url: string, init?: RequestInit) => {
      if (!held && init?.method === 'PUT') {
        held = true;
        await gate;
      }
      return base(url, init);
    }) as unknown as typeof fetch;
    const replace = controller.syncFormSheetHeaders(asOwner(), formId, { replace: true });
    await new Promise((r) => setTimeout(r, 0));
    const renamed = ['Submitted', 'Work email', 'Company'];
    // The rename's own sync sees a foreign row 1 (the replace has not landed).
    await controller.putDestinations(asOwner(), formId, { destinations: [fromEditor(renamed)] });
    release();
    await expect(replace).resolves.toEqual({ ok: true, outcome: 'stale' });
    expect(row1).toEqual(OLD);
    // The snapshot says what row 1 really holds, so the next save fixes it.
    await controller.putDestinations(asOwner(), formId, { destinations: [{ ...fromEditor(renamed), enabled: false }] });
    expect(row1).toEqual(renamed);
  });
});

describe('what is known about row 1 is persisted whenever it changes', () => {
  it('a replace that rewrites row 1 clears a stale foreign mark (the reviewed repro)', async () => {
    const NEW1 = ['Submitted', 'Work email', 'Company'];
    await store({
      ...fromEditor(OLD),
      settings: {
        spreadsheetId: SHEET,
        sheetTitle: 'Responses',
        headerSnapshot: { spreadsheetId: SHEET, sheetTitle: 'Responses', headers: OLD },
      },
    });
    // Someone types a heading of their own past ours, in the sheet.
    row1 = [...OLD, 'Notes'];
    await controller.putDestinations(asOwner(), formId, { destinations: [fromEditor(NEW1)] }); // foreign, NEW1
    await controller.putDestinations(asOwner(), formId, { destinations: [fromEditor(OLD)] }); // back: in sync on paper
    await controller.syncFormSheetHeaders(asOwner(), formId, { replace: true }); // row 1 = OLD, Notes cleared
    expect(row1).toEqual(OLD);
    // Back to NEW1: row 1 IS dForms' own now, so it follows. Before, the
    // stale foreign mark for NEW1 made this skip Google entirely.
    await controller.putDestinations(asOwner(), formId, { destinations: [fromEditor(NEW1)] });
    expect(row1).toEqual(NEW1);
  });
});

describe('a sync that fails for good is not paid for on every save', () => {
  it('remembers a permanent failure for these headings, and the button still asks', async () => {
    await store(fromEditor(OLD));
    let calls = 0;
    controller.fetchImpl = (async () => {
      calls += 1;
      return new Response('{}', { status: 404 });
    }) as unknown as typeof fetch;
    const renamed = ['Submitted', 'Work email', 'Company'];
    const first = await controller.putDestinations(asOwner(), formId, { destinations: [fromEditor(renamed)] });
    expect((first as { sheetHeaders?: unknown }).sheetHeaders).toEqual({ outcome: 'failed', reason: 'not_found' });
    const after = calls;
    // Unrelated saves: no Google call, and no failure re-shown each time.
    const second = await controller.putDestinations(asOwner(), formId, {
      destinations: [{ ...fromEditor(renamed), enabled: false }],
    });
    expect(calls).toBe(after);
    expect((second as { sheetHeaders?: unknown }).sheetHeaders).toBeUndefined();
    // The button is an explicit request, so it asks anyway.
    await controller.syncFormSheetHeaders(asOwner(), formId);
    expect(calls).toBeGreaterThan(after);
  });

  it('does not remember a transient failure: the next save tries again', async () => {
    await store(fromEditor(OLD));
    let calls = 0;
    controller.fetchImpl = (async () => {
      calls += 1;
      return new Response('{}', { status: 503 });
    }) as unknown as typeof fetch;
    const renamed = ['Submitted', 'Work email', 'Company'];
    await controller.putDestinations(asOwner(), formId, { destinations: [fromEditor(renamed)] });
    const after = calls;
    await controller.putDestinations(asOwner(), formId, { destinations: [{ ...fromEditor(renamed), enabled: false }] });
    expect(calls).toBeGreaterThan(after);
  });
});

describe('the API-owned Sheets keys, on every Sheets entry (set_destinations goes through putDestinations)', () => {
  it('strips a forged snapshot and failure mark from a SECOND entry, so it syncs normally once it is the first', async () => {
    row1 = ['Name', 'Phone']; // somebody's own heading row
    const forged = { spreadsheetId: SHEET, sheetTitle: 'Responses', headers: ['Name', 'Phone'] };
    const sheetsA = { ...fromEditor(OLD), settings: { spreadsheetId: 'sheet-A', sheetTitle: 'Responses' } };
    const sheetsB = {
      ...fromEditor(OLD),
      settings: {
        spreadsheetId: SHEET,
        sheetTitle: 'Responses',
        headerSnapshot: forged,
        headerBroken: { ...forged, reason: 'forbidden', at: Date.now() + 10 * 365 * 24 * 3600_000 },
      },
    };
    await controller.putDestinations(asOwner(), formId, { destinations: [sheetsA, sheetsB] });
    const stored = async () =>
      (((await getFormById(db, accountId, formId))!.config as { destinations: Record<string, unknown>[] }).destinations);
    const storedB = (await stored())[1]!.settings as Record<string, unknown>;
    expect(storedB).not.toHaveProperty('headerSnapshot');
    expect(storedB).not.toHaveProperty('headerBroken');

    // Remove A: B is the first Sheets entry now. It must ask Google (the
    // forged far-future failure mark is gone) and must NOT overwrite the
    // foreign row 1 (the forged snapshot claiming it is gone too).
    reads = 0;
    const out = await controller.putDestinations(asOwner(), formId, {
      destinations: [{ ...sheetsB, settings: { spreadsheetId: SHEET, sheetTitle: 'Responses' } }],
    });
    expect(reads).toBeGreaterThan(0);
    expect((out as { sheetHeaders?: { outcome: string } }).sheetHeaders?.outcome).toBe('foreign');
    expect(row1).toEqual(['Name', 'Phone']);
  });

  it('ignores a stored failure mark dated in the future', async () => {
    await store({
      ...fromEditor(OLD),
      settings: {
        spreadsheetId: SHEET,
        sheetTitle: 'Responses',
        headerBroken: {
          spreadsheetId: SHEET,
          sheetTitle: 'Responses',
          headers: ['Submitted', 'Work email', 'Company'],
          reason: 'forbidden',
          at: Date.now() + 3600_000,
        },
      },
    });
    reads = 0;
    await controller.putDestinations(asOwner(), formId, {
      destinations: [fromEditor(['Submitted', 'Work email', 'Company'])],
    });
    expect(reads).toBeGreaterThan(0);
  });
});

describe('recording a snapshot never replaces a newer one', () => {
  it('gives up on the FIRST attempt when a newer snapshot was recorded since the read', async () => {
    const older = { spreadsheetId: SHEET, sheetTitle: 'Responses', headers: OLD };
    const newer = { spreadsheetId: SHEET, sheetTitle: 'Responses', headers: ['Submitted', 'Work email', 'Company'] };
    await store({ ...fromEditor(OLD), settings: { spreadsheetId: SHEET, sheetTitle: 'Responses', headerSnapshot: newer } });
    // The request read `older`; a save recorded `newer` before it got here.
    await (controller as unknown as {
      recordSheetState: (a: string, f: string, s: unknown, r: unknown) => Promise<void>;
    }).recordSheetState(accountId, formId, { snapshot: older, foreign: null }, older);
    expect(await storedSnapshot()).toEqual(newer);
  });
});

describe('a heading cleared on a column dForms already wrote keeps its place', () => {
  // The author renames the middle column: clears "Email", pauses, types the
  // new name. While it is empty the column used to leave the sheet: row 1 was
  // rewritten without it and every response delivered in that window put
  // Company's answer under Email. Now the position is held.
  const cleared = () => {
    const d = fromEditor(OLD);
    d.columns[1] = { ...d.columns[1]!, header: '' };
    return d;
  };

  it('does not rewrite row 1 while the heading is empty, and reports nothing to fix', async () => {
    await store(fromEditor(OLD));
    await controller.putDestinations(asOwner(), formId, { destinations: [fromEditor(OLD)] });
    expect(row1).toEqual(OLD);
    writes = [];
    reads = 0;
    const out = await controller.putDestinations(asOwner(), formId, { destinations: [cleared()] });
    expect(writes).toEqual([]);
    expect(row1).toEqual(OLD);
    // Known to be in sync (the held position is what row 1 already says): no Google call at all.
    expect(reads).toBe(0);
    expect((out as { sheetHeaders?: unknown }).sheetHeaders).toBeUndefined();
    expect(await storedSnapshot()).toEqual({ spreadsheetId: SHEET, sheetTitle: 'Responses', headers: OLD });
  });

  it('writes the new name in the SAME position once it is typed', async () => {
    await store(fromEditor(OLD));
    await controller.putDestinations(asOwner(), formId, { destinations: [fromEditor(OLD)] });
    await controller.putDestinations(asOwner(), formId, { destinations: [cleared()] });
    await controller.putDestinations(asOwner(), formId, {
      destinations: [fromEditor(['Submitted', 'Work email', 'Company'])],
    });
    expect(row1).toEqual(['Submitted', 'Work email', 'Company']);
  });

  it('rewrites row 1 without it only when the column is deleted for real', async () => {
    await store(fromEditor(OLD));
    await controller.putDestinations(asOwner(), formId, { destinations: [fromEditor(OLD)] });
    await controller.putDestinations(asOwner(), formId, { destinations: [cleared()] });
    const d = cleared();
    d.columns.splice(1, 1);
    await controller.putDestinations(asOwner(), formId, { destinations: [d] });
    expect(row1).toEqual(['Submitted', 'Company']);
  });

  it('still leaves a never-named column out of row 1', async () => {
    await store(fromEditor(OLD));
    await controller.putDestinations(asOwner(), formId, { destinations: [fromEditor(OLD)] });
    writes = [];
    const d = fromEditor(OLD);
    d.columns.push({ header: '', source: 'answer', key: 'extra' });
    await controller.putDestinations(asOwner(), formId, { destinations: [d] });
    expect(writes).toEqual([]);
    expect(row1).toEqual(OLD);
  });
});

describe('MCP set_destinations reports what the save did to row 1', () => {
  const caller = () =>
    ({
      accountId,
      workspaceName: 'Acme',
      memberId: 'm1',
      role: 'owner',
      bucket: 'b',
      context: { req: asOwner() },
    }) as never;
  const backend = () =>
    new ApiMcpBackend(
      db,
      () => ({}) as never,
      () => ({ destinations: controller }) as never,
    );

  it('carries the route\'s `foreign` outcome, with what row 1 holds and what would be written', async () => {
    row1 = ['Name', 'Phone']; // somebody's own heading row
    const out = await backend().setDestinations(caller(), formId, [fromEditor(OLD)]);
    expect(out.sheetHeaders).toEqual({ outcome: 'foreign', current: ['Name', 'Phone'], headers: OLD });
    expect(row1).toEqual(['Name', 'Phone']);
  });

  it('carries `written` when the row was brought in line, and null when the save had no reason to look', async () => {
    await store(fromEditor(OLD));
    const first = await backend().setDestinations(caller(), formId, [fromEditor([...OLD, 'booking'])]);
    expect(first.sheetHeaders).toEqual({ outcome: 'written' });
    const second = await backend().setDestinations(caller(), formId, [
      { ...fromEditor([...OLD, 'booking']), enabled: false },
    ]);
    expect(second.sheetHeaders).toBeNull();
  });
});
