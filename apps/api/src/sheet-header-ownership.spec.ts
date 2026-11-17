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
  it('adds the "booking" heading to a row 1 written from the previous columns', async () => {
    // Stored before snapshots existed: the create call wrote row 1, nothing recorded it.
    await store(fromEditor(OLD));
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

  it('asks Google nothing when a save leaves the headings as they were', async () => {
    await store(fromEditor(OLD));
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
    expect((out as { sheetHeaders?: unknown }).sheetHeaders).toEqual({ outcome: 'foreign' });
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
