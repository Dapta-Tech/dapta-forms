// @vitest-environment happy-dom
/**
 * The spreadsheet card, from the author's side.
 *
 * What it pins is the shape the `drive.file` scope forces on the product: a
 * spreadsheet reaches a form by being created here or chosen in Google's
 * Picker, and by no other route. A field to paste a link into would look
 * helpful and could never work, so its ABSENCE is a promise of this card.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { getMessages } from '@quill/shared';
import type { QuestionMeta } from './auto-map';

const actions = vi.hoisted(() => ({
  googleSheetsCreateAction: vi.fn(),
  googleSheetsPickerAction: vi.fn(),
  googleSheetsTabsAction: vi.fn(),
  googleSheetsHeaderRowAction: vi.fn(),
}));
vi.mock('./actions', () => actions);

const picker = vi.hoisted(() => ({ pickSpreadsheet: vi.fn() }));
vi.mock('./google-picker', () => picker);

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('@/components/toast', () => ({ useToast: () => toasts }));

import { GoogleSheetsCard, type GoogleSheetsState } from './google-sheets-card';

const m = getMessages('en').admin.integrations;
const QUESTIONS: QuestionMeta[] = [
  { key: 'email', label: 'Work email', type: 'email' },
  { key: 'company', label: 'Company', type: 'short_text' },
];
const EMPTY: GoogleSheetsState = { enabled: true, spreadsheetId: '', sheetTitle: '', columns: [] };

let root: Root | null = null;
let container: HTMLElement | null = null;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.clearAllMocks();
});

/** Mounts the card over a real piece of state, the way the editor holds it. */
async function mount(
  opts: {
    state?: GoogleSheetsState;
    connected?: boolean;
    pickerAvailable?: boolean;
    formName?: string;
  } = {},
) {
  const box = { state: opts.state ?? EMPTY };
  const setState = vi.fn((next: GoogleSheetsState) => {
    box.state = next;
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <GoogleSheetsCard
        state={box.state}
        setState={setState}
        questions={QUESTIONS}
        connected={opts.connected ?? true}
        pickerAvailable={opts.pickerAvailable ?? false}
        formName={opts.formName ?? 'Lead form'}
        locale="en"
        m={m}
      />,
    );
  });
  return { el: container, setState, box };
}

const button = (el: HTMLElement, text: string): HTMLButtonElement | undefined =>
  [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(text));

describe('how a spreadsheet reaches a form', () => {
  it('offers to create one, and has no field to paste a link into', async () => {
    const { el } = await mount();
    expect(button(el, m.gsheets.createSheet)).toBeDefined();
    expect(el.textContent).toContain(m.gsheets.sheetHelp);
    // Every text input left on the card belongs to a column row, and there are
    // none yet: nothing here takes a spreadsheet address.
    expect(el.querySelectorAll('input[type="text"], input:not([type])')).toHaveLength(0);
  });

  it('offers Google Drive only where the deployment can open the Picker', async () => {
    const without = await mount({ pickerAvailable: false });
    expect(button(without.el, m.gsheets.chooseSheet)).toBeUndefined();
    act(() => root?.unmount());
    container?.remove();

    const withPicker = await mount({ pickerAvailable: true });
    expect(button(withPicker.el, m.gsheets.chooseSheet)).toBeDefined();
  });

  it('says to connect Google first, and offers neither, without a connection', async () => {
    const { el } = await mount({ connected: false, pickerAvailable: true });
    expect(el.querySelector('[data-testid="gsheets-not-connected"]')).not.toBeNull();
    expect(button(el, m.gsheets.createSheet)).toBeUndefined();
    expect(button(el, m.gsheets.chooseSheet)).toBeUndefined();
  });
});

describe('creating a spreadsheet', () => {
  const created = {
    ok: true as const,
    data: {
      ok: true as const,
      spreadsheetId: 'new-id',
      spreadsheetTitle: 'Lead form (responses)',
      sheetTitle: 'Responses',
      gid: 0,
    },
  };

  it('names it after the form and sends the form’s questions as the header row', async () => {
    actions.googleSheetsCreateAction.mockResolvedValueOnce(created);
    const { el } = await mount({ formName: 'Lead form' });
    await act(async () => button(el, m.gsheets.createSheet)!.click());
    expect(actions.googleSheetsCreateAction).toHaveBeenCalledWith({
      title: 'Lead form (responses)',
      sheetTitle: m.gsheets.defaultTab,
      headers: [
        m.gsheets.colSubmittedAt,
        'Work email',
        'Company',
        m.gsheets.colScore,
        m.gsheets.colOutcome,
      ],
    });
  });

  it('stores the new spreadsheet, its tab and the columns it was created with', async () => {
    actions.googleSheetsCreateAction.mockResolvedValueOnce(created);
    const { el, setState } = await mount();
    await act(async () => button(el, m.gsheets.createSheet)!.click());
    const next = setState.mock.calls.at(-1)![0];
    expect(next.spreadsheetId).toBe('new-id');
    expect(next.sheetTitle).toBe('Responses');
    // The columns in state are the ones whose headings went into row 1, so the
    // first delivery lines up with the header that is already there.
    expect(next.columns.map((c: { header: string }) => c.header)).toEqual([
      m.gsheets.colSubmittedAt,
      'Work email',
      'Company',
      m.gsheets.colScore,
      m.gsheets.colOutcome,
    ]);
    expect(toasts.success).toHaveBeenCalledWith(m.gsheets.sheetCreated);
  });

  it('keeps the columns an author already arranged, instead of replacing them', async () => {
    actions.googleSheetsCreateAction.mockResolvedValueOnce(created);
    const mine = [{ header: 'Correo', source: 'answer' as const, key: 'email' }];
    const { el, setState } = await mount({ state: { ...EMPTY, columns: mine } });
    await act(async () => button(el, m.gsheets.createSheet)!.click());
    expect(actions.googleSheetsCreateAction.mock.calls[0]![0].headers).toEqual(['Correo']);
    expect(setState.mock.calls.at(-1)![0].columns).toEqual(mine);
  });

  it('falls back to a name of its own for a form with none', async () => {
    actions.googleSheetsCreateAction.mockResolvedValueOnce(created);
    const { el } = await mount({ formName: '   ' });
    await act(async () => button(el, m.gsheets.createSheet)!.click());
    expect(actions.googleSheetsCreateAction.mock.calls[0]![0].title).toBe(
      `${m.gsheets.title} (responses)`,
    );
  });

  it('stores nothing and says so when Google refuses', async () => {
    actions.googleSheetsCreateAction.mockResolvedValueOnce({
      ok: true,
      data: { ok: false, reason: 'unavailable' },
    });
    const { el, setState } = await mount();
    await act(async () => button(el, m.gsheets.createSheet)!.click());
    expect(setState).not.toHaveBeenCalled();
    expect(toasts.error).toHaveBeenCalledWith(m.gsheets.createFailed);
  });

  it('sends the author to reconnect when the grant is gone', async () => {
    actions.googleSheetsCreateAction.mockResolvedValueOnce({
      ok: true,
      data: { ok: false, reason: 'forbidden' },
    });
    const { el } = await mount();
    await act(async () => button(el, m.gsheets.createSheet)!.click());
    expect(toasts.error).toHaveBeenCalledWith(m.gsheets.sheetForbidden);
  });
});

describe('choosing a spreadsheet from Google Drive', () => {
  const config = {
    ok: true as const,
    data: { enabled: true as const, accessToken: 'ya29.t', apiKey: 'k', appId: '123' },
  };

  it('opens the Picker with what the server handed over, and stores the choice', async () => {
    actions.googleSheetsPickerAction.mockResolvedValueOnce(config);
    picker.pickSpreadsheet.mockResolvedValueOnce({ id: 'picked-id', name: 'Leads 2026' });
    actions.googleSheetsTabsAction.mockResolvedValue({
      ok: true,
      data: { enabled: true, spreadsheetTitle: 'Leads 2026', tabs: [] },
    });
    const { el, setState } = await mount({ pickerAvailable: true });
    await act(async () => button(el, m.gsheets.chooseSheet)!.click());
    expect(picker.pickSpreadsheet).toHaveBeenCalledWith({
      accessToken: 'ya29.t',
      apiKey: 'k',
      appId: '123',
      locale: 'en',
    });
    expect(setState.mock.calls.at(-1)![0]).toMatchObject({ spreadsheetId: 'picked-id' });
  });

  // The tab named a tab of the PREVIOUS spreadsheet. Kept, it would be matched
  // against the new one's tabs at delivery time and miss on every submission.
  it('clears the tab, which belonged to the spreadsheet before it', async () => {
    actions.googleSheetsPickerAction.mockResolvedValueOnce(config);
    picker.pickSpreadsheet.mockResolvedValueOnce({ id: 'picked-id', name: 'x' });
    actions.googleSheetsTabsAction.mockResolvedValue({
      ok: true,
      data: { enabled: true, spreadsheetTitle: 'old', tabs: [] },
    });
    const { el, setState } = await mount({
      pickerAvailable: true,
      state: { ...EMPTY, spreadsheetId: 'old-id', sheetTitle: 'Q3' },
    });
    await act(async () => button(el, m.gsheets.chooseSheet)!.click());
    expect(setState.mock.calls.at(-1)![0]).toMatchObject({
      spreadsheetId: 'picked-id',
      sheetTitle: '',
    });
  });

  it('changes nothing and announces nothing when the dialog is closed', async () => {
    actions.googleSheetsPickerAction.mockResolvedValueOnce(config);
    picker.pickSpreadsheet.mockResolvedValueOnce(null);
    const { el, setState } = await mount({ pickerAvailable: true });
    await act(async () => button(el, m.gsheets.chooseSheet)!.click());
    expect(setState).not.toHaveBeenCalled();
    expect(toasts.error).not.toHaveBeenCalled();
    expect(toasts.success).not.toHaveBeenCalled();
  });

  it('opens no Picker when the server has none to offer', async () => {
    actions.googleSheetsPickerAction.mockResolvedValueOnce({
      ok: true,
      data: { enabled: false, reason: 'not_connected' },
    });
    const { el } = await mount({ pickerAvailable: true });
    await act(async () => button(el, m.gsheets.chooseSheet)!.click());
    expect(picker.pickSpreadsheet).not.toHaveBeenCalled();
    expect(toasts.error).toHaveBeenCalledWith(m.gsheets.pickerFailed);
  });

  it('says so when the Picker itself cannot be loaded', async () => {
    actions.googleSheetsPickerAction.mockResolvedValueOnce(config);
    picker.pickSpreadsheet.mockRejectedValueOnce(new Error('script blocked'));
    const { el, setState } = await mount({ pickerAvailable: true });
    await act(async () => button(el, m.gsheets.chooseSheet)!.click());
    expect(setState).not.toHaveBeenCalled();
    expect(toasts.error).toHaveBeenCalledWith(m.gsheets.pickerFailed);
  });
});

describe('a form that already has its spreadsheet', () => {
  it('links to it by name once the tab list says what it is called', async () => {
    actions.googleSheetsTabsAction.mockResolvedValue({
      ok: true,
      data: {
        enabled: true,
        spreadsheetTitle: 'Leads 2026',
        tabs: [{ title: 'Responses', gid: 0 }],
      },
    });
    const { el } = await mount({ state: { ...EMPTY, spreadsheetId: 'abc123', sheetTitle: 'Responses' } });
    const link = el.querySelector<HTMLAnchorElement>('[data-testid="gsheets-current"]')!;
    expect(link.textContent).toContain('Leads 2026');
    expect(link.href).toBe('https://docs.google.com/spreadsheets/d/abc123/edit');
  });

  // Under drive.file, this is what a spreadsheet the app was never handed looks
  // like, so the message has to send the author to the Picker, not to a link.
  it('sends the author back to Google Drive when Google no longer lets the app open it', async () => {
    actions.googleSheetsTabsAction.mockResolvedValue({
      ok: true,
      data: { enabled: false, reason: 'not_found' },
    });
    const { el } = await mount({ state: { ...EMPTY, spreadsheetId: 'gone' } });
    expect(el.textContent).toContain(m.gsheets.sheetNotFound);
  });

  // A column saved on a key the form no longer offers (a `name` question's own
  // key, from before it was offered as its two answers) must keep showing what
  // is stored instead of reading as "pick one".
  it('keeps a stored answer key the form no longer offers selected as itself', async () => {
    actions.googleSheetsTabsAction.mockResolvedValue({
      ok: true,
      data: { enabled: true, spreadsheetTitle: 'Leads', tabs: [{ title: 'Responses', gid: 0 }] },
    });
    const { el } = await mount({
      state: {
        ...EMPTY,
        spreadsheetId: 'abc123',
        sheetTitle: 'Responses',
        columns: [{ header: 'Full name', source: 'answer', key: 'full_name' }],
      },
    });
    const select = el.querySelector<HTMLSelectElement>(`select[aria-label="${m.gsheets.keyFor}"]`)!;
    expect(select.value).toBe('full_name');
    expect([...select.options].map((o) => o.value)).toEqual(['', 'full_name', 'email', 'company']);
  });
});
