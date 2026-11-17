// @vitest-environment happy-dom
/**
 * The spreadsheet card, from the author's side.
 *
 * What it pins is the shape the `drive.file` scope forces on the product: a
 * spreadsheet reaches a form by being created here or chosen in Google's
 * Picker, and by no other route. A field to paste a link into would look
 * helpful and could never work, so its ABSENCE is a promise of this card.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { getMessages } from '@quill/shared';
import { GOOGLE_SHEETS_BUTTON } from '@/components/ui/provider-logo';
import type { QuestionMeta } from './auto-map';

const actions = vi.hoisted(() => ({
  googleSheetsCreateAction: vi.fn(),
  googleSheetsPickerAction: vi.fn(),
  googleSheetsTabsAction: vi.fn(),
  syncSheetHeadersAction: vi.fn(),
}));
vi.mock('./actions', () => actions);

const connectActions = vi.hoisted(() => ({
  startGoogleSheetsAuthAction: vi.fn(),
  connectIntegrationAction: vi.fn(),
  connectSalesforceAction: vi.fn(),
}));
vi.mock('@/app/admin/integrations/actions', () => connectActions);

const picker = vi.hoisted(() => ({ pickSpreadsheet: vi.fn() }));
vi.mock('./google-picker', () => picker);

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('@/components/toast', () => ({ useToast: () => toasts }));

import { GoogleSheetsCard, sheetColumnLetter, type GoogleSheetsState } from './google-sheets-card';
import type { ConnectAccess } from './connect-in-place';
import type { SheetHeaderSync } from '@/lib/admin-api';

const m = getMessages('en').admin.integrations;
const QUESTIONS: QuestionMeta[] = [
  { key: 'email', label: 'Work email', type: 'email' },
  { key: 'company', label: 'Company', type: 'short_text' },
];
const EMPTY: GoogleSheetsState = { enabled: true, spreadsheetId: '', sheetTitle: '', columns: [] };
const STORED_FOR_MEMBER: GoogleSheetsState = {
  enabled: true,
  spreadsheetId: 'sheet-1',
  sheetTitle: 'Responses',
  columns: [{ header: 'Email', source: 'answer', key: 'email' }],
};

let root: Root | null = null;
let container: HTMLElement | null = null;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  // The card looks at row 1 once when it opens on a spreadsheet.
  actions.syncSheetHeadersAction.mockResolvedValue({ ok: true, data: { ok: true, outcome: 'unchanged' } });
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
    formId?: string;
    access?: ConnectAccess;
    headerSync?: SheetHeaderSync | null;
  } = {},
) {
  const box = { state: opts.state ?? EMPTY };
  const setState = vi.fn((next: GoogleSheetsState) => {
    box.state = next;
  });
  const onHeaderSync = vi.fn();
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
        formId={opts.formId}
        access={opts.access}
        headerSync={opts.headerSync ?? null}
        onHeaderSync={onHeaderSync}
        locale="en"
        m={m}
      />,
    );
  });
  return { el: container, setState, box, onHeaderSync };
}

const button = (el: HTMLElement, text: string): HTMLButtonElement | undefined =>
  [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(text));

describe('how a spreadsheet reaches a form', () => {
  it('offers to create one, and has no field to paste a link into', async () => {
    const { el } = await mount();
    expect(button(el, m.gsheets.createSheet)).toBeDefined();
    expect(el.textContent).toContain(m.gsheets.sheetHelpCreateOnly);
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

describe('connecting Google from the card itself', () => {
  const cm = getMessages('en').admin.connections;
  const assign = vi.fn();
  beforeAll(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, assign },
    });
  });

  it('starts Google’s consent flow and asks to come back to this form', async () => {
    const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?state=v2.p.s';
    connectActions.startGoogleSheetsAuthAction.mockResolvedValueOnce({ ok: true, authUrl });
    const { el } = await mount({ connected: false, formId: 'form-1' });
    expect(el.querySelector('a[href="/admin/integrations"]')).toBeNull();
    await act(async () => button(el, cm.connectWithGoogle)!.click());
    expect(connectActions.startGoogleSheetsAuthAction).toHaveBeenCalledWith('/admin/forms/form-1/edit');
    expect(assign).toHaveBeenCalledWith(authUrl);
  });

  it('tells a plain member an admin has to connect it, and offers no button', async () => {
    const { el } = await mount({
      connected: false,
      formId: 'form-1',
      access: { canConnect: false, encryptionAvailable: true },
    });
    expect(el.querySelector('[data-testid="connect-admin-only"]')?.textContent).toContain('Google Sheets');
    expect(el.querySelector('button')?.getAttribute('role')).toBe('switch');
    expect(button(el, cm.connectWithGoogle)).toBeUndefined();
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
    await act(async () => el.querySelector<HTMLButtonElement>('[data-testid="gsheets-change"]')!.click());
    await act(async () => button(el, m.gsheets.chooseSheet)!.click());
    await act(async () => el.querySelector<HTMLButtonElement>('[data-testid="confirm-dialog-confirm"]')!.click());
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

/**
 * What a plain member is offered. Google's Picker needs an access token the
 * API hands to owners and admins only, so "Choose from Google Drive" could
 * only fail for a member (it answered with a generic toast). Creating a
 * spreadsheet, the tab list and the header row are open to every role.
 */
describe('what a member is offered on the card', () => {
  const MEMBER: ConnectAccess = { canConnect: false, encryptionAvailable: true };

  it('has no "Choose from Google Drive" button, and says an owner or admin has to', async () => {
    const { el } = await mount({ pickerAvailable: true, access: MEMBER });
    expect(button(el, m.gsheets.chooseSheet)).toBeUndefined();
    expect(el.querySelector('[data-testid="gsheets-choose-admin-only"]')?.textContent).toBe(m.gsheets.chooseAdminOnly);
    // And the help line does not promise Drive either.
    expect(el.textContent).toContain(m.gsheets.sheetHelpCreateOnly);
    expect(el.textContent).not.toContain(m.gsheets.sheetHelp);
  });

  it('keeps what the API lets a member do: create a sheet and update the header row', async () => {
    const { el } = await mount({ pickerAvailable: true, access: MEMBER, state: STORED_FOR_MEMBER, formId: 'form-1' });
    // With a sheet attached, creating another one sits behind "Change sheet".
    await act(async () => el.querySelector<HTMLButtonElement>('[data-testid="gsheets-change"]')!.click());
    expect(button(el, m.gsheets.createSheet)).toBeDefined();
    expect(button(el, m.gsheets.chooseSheet)).toBeUndefined();
    expect(el.querySelector('[data-testid="gsheets-choose-admin-only"]')?.textContent).toBe(m.gsheets.chooseAdminOnly);
    expect(el.querySelector<HTMLButtonElement>('[data-testid="gsheets-sync-headers"]')?.disabled).toBe(false);
  });

  it('shows an owner or admin the button, and no such sentence', async () => {
    const { el } = await mount({ pickerAvailable: true });
    expect(button(el, m.gsheets.chooseSheet)).toBeDefined();
    expect(el.querySelector('[data-testid="gsheets-choose-admin-only"]')).toBeNull();
  });
});

/**
 * The attached state, and what it takes to change it.
 *
 * With a spreadsheet attached the card used to show a small chip with the
 * sheet's name and, right under it, "Create a new spreadsheet": one click
 * made a second spreadsheet and repointed the form, and nothing on the card
 * said which sheet the responses were going to.
 */
describe('a spreadsheet is attached', () => {
  const ATTACHED: GoogleSheetsState = {
    enabled: true,
    spreadsheetId: 'abc123',
    sheetTitle: 'Responses',
    columns: [{ header: 'Email', source: 'answer', key: 'email' }],
  };
  const created = {
    ok: true as const,
    data: { ok: true as const, spreadsheetId: 'new-id', spreadsheetTitle: 'Lead form (responses)', sheetTitle: 'Responses', gid: 0 },
  };
  const named = () =>
    actions.googleSheetsTabsAction.mockResolvedValue({
      ok: true,
      data: { enabled: true, spreadsheetTitle: 'Leads 2026', tabs: [{ title: 'Sheet1', gid: 0 }, { title: 'Responses', gid: 7 }] },
    });
  const q = <T extends HTMLElement>(el: HTMLElement, id: string) => el.querySelector<T>(`[data-testid="${id}"]`);
  const click = (el: HTMLElement, id: string) => act(async () => q<HTMLButtonElement>(el, id)!.click());

  it('says where responses go in one block: the name, the tab in a sentence, and a Sheets-green button to open it', async () => {
    named();
    const { el } = await mount({ state: ATTACHED, pickerAvailable: true });
    const block = q(el, 'gsheets-attached')!;
    expect(q(block, 'gsheets-attached-name')?.textContent).toBe('Leads 2026');
    expect(q(block, 'gsheets-attached-where')?.textContent).toBe(m.gsheets.attachedInTab.replace('{tab}', 'Responses'));
    const open = q<HTMLAnchorElement>(block, 'gsheets-current')!;
    expect(open.textContent).toBe(m.gsheets.openSheetButton);
    // Google Sheets green with white text, from the one place it is defined:
    // not the ink default, not Signal Green, not an outline chip.
    for (const cls of GOOGLE_SHEETS_BUTTON.split(' ')) expect(open.className.split(' ')).toContain(cls);
    expect(open.className).toContain('bg-[#188038]');
    expect(open.className).toContain('text-white');
    expect(open.className).not.toContain('bg-primary');
    expect(open.className).not.toContain('bg-signal');
    expect(open.querySelector('.pi-external-link')).not.toBeNull();
    // The card's header already shows the Sheets logo: none in the block, none in the button.
    expect(block.querySelector('[data-provider-logo]')).toBeNull();
    expect(open.target).toBe('_blank');
    expect(open.rel.split(' ').sort()).toEqual(['noopener', 'noreferrer']);
    // No bare underlined link anywhere on the card.
    for (const a of el.querySelectorAll('a')) expect(a.className).not.toContain('underline');
  });

  it('names the first tab by its own name when no tab is chosen, and says "first tab" until it knows it', async () => {
    named();
    const first = await mount({ state: { ...ATTACHED, sheetTitle: '' } });
    expect(q(first.el, 'gsheets-attached-where')?.textContent).toBe(m.gsheets.attachedInTab.replace('{tab}', 'Sheet1'));
    act(() => root!.unmount());
    container!.remove();
    actions.googleSheetsTabsAction.mockResolvedValue({ ok: false, transport: true, message: 'down' });
    const unknown = await mount({ state: { ...ATTACHED, sheetTitle: '' } });
    expect(q(unknown.el, 'gsheets-attached-where')?.textContent).toBe(m.gsheets.attachedFirstTab);
    expect(q(unknown.el, 'gsheets-attached-name')?.textContent).toBe(m.gsheets.attachedUnnamed);
  });

  it('does not offer "create" or "choose" beside the attached sheet: one quiet "Change sheet" reveals them', async () => {
    named();
    const { el } = await mount({ state: ATTACHED, pickerAvailable: true });
    expect(button(el, m.gsheets.createSheet)).toBeUndefined();
    expect(button(el, m.gsheets.chooseSheet)).toBeUndefined();
    expect(q(el, 'gsheets-change')?.textContent).toBe(m.gsheets.changeSheet);
    await click(el, 'gsheets-change');
    expect(q(el, 'gsheets-change-options')?.textContent).toContain(m.gsheets.changeHelp);
    expect(button(el, m.gsheets.createSheet)).toBeDefined();
    expect(button(el, m.gsheets.chooseSheet)).toBeDefined();
    // "Keep this sheet" puts them away again, and nothing was asked of Google.
    await act(async () => button(el, m.gsheets.changeKeep)!.click());
    expect(q(el, 'gsheets-change-options')).toBeNull();
    expect(actions.googleSheetsCreateAction).not.toHaveBeenCalled();
  });

  it('asks before creating another spreadsheet, and Cancel creates nothing and changes nothing', async () => {
    named();
    const { el, setState, onHeaderSync } = await mount({ state: ATTACHED, formId: 'form-1' });
    onHeaderSync.mockClear();
    await click(el, 'gsheets-change');
    await click(el, 'gsheets-create');
    expect(q(el, 'confirm-dialog')?.textContent).toContain(m.gsheets.changeTitle);
    // In plain words, naming the sheet that stops receiving responses.
    expect(q(el, 'confirm-dialog')?.textContent).toContain(m.gsheets.changeBodyCreate.replace('{name}', 'Leads 2026'));
    expect(actions.googleSheetsCreateAction).not.toHaveBeenCalled();
    await click(el, 'confirm-dialog-cancel');
    expect(actions.googleSheetsCreateAction).toHaveBeenCalledTimes(0);
    expect(setState).not.toHaveBeenCalled();
    expect(onHeaderSync).not.toHaveBeenCalledWith(null);
    expect(toasts.success).not.toHaveBeenCalled();
  });

  it('on confirm creates exactly one, attaches it, and forgets what it knew about the old sheet\'s row 1', async () => {
    named();
    actions.googleSheetsCreateAction.mockResolvedValueOnce(created);
    const { el, setState, onHeaderSync } = await mount({
      state: { ...ATTACHED, writtenHeaders: ['Email'] },
      formId: 'form-1',
      headerSync: { outcome: 'foreign', current: ['Name'], headers: ['Email'] },
    });
    await click(el, 'gsheets-change');
    await click(el, 'gsheets-create');
    await click(el, 'confirm-dialog-confirm');
    expect(actions.googleSheetsCreateAction).toHaveBeenCalledTimes(1);
    expect(setState.mock.calls.at(-1)![0]).toMatchObject({
      spreadsheetId: 'new-id',
      sheetTitle: 'Responses',
      writtenHeaders: null,
      // The columns the author arranged ride over to the new sheet.
      columns: ATTACHED.columns,
    });
    expect(onHeaderSync).toHaveBeenCalledWith(null);
  });

  it('asks before the Picker opens, and Cancel never opens it', async () => {
    named();
    const { el, setState } = await mount({ state: ATTACHED, pickerAvailable: true });
    await click(el, 'gsheets-change');
    await click(el, 'gsheets-choose');
    expect(q(el, 'confirm-dialog')?.textContent).toContain(m.gsheets.changeBodyChoose.replace('{name}', 'Leads 2026'));
    await click(el, 'confirm-dialog-cancel');
    expect(actions.googleSheetsPickerAction).not.toHaveBeenCalled();
    expect(picker.pickSpreadsheet).not.toHaveBeenCalled();
    expect(setState).not.toHaveBeenCalled();
  });
});

/**
 * One spreadsheet per press. A double click lands twice before React has
 * rendered the disabled button, and a slow Google answer left the button
 * looking ready: each extra click made another spreadsheet in the author's
 * Drive.
 */
describe('creating a spreadsheet, once', () => {
  const created = {
    ok: true as const,
    data: { ok: true as const, spreadsheetId: 'new-id', spreadsheetTitle: 'Lead form (responses)', sheetTitle: 'Responses', gid: 0 },
  };
  const createBtn = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('[data-testid="gsheets-create"]')!;

  it('a double click creates one spreadsheet', async () => {
    let answer!: (v: unknown) => void;
    actions.googleSheetsCreateAction.mockImplementation(() => new Promise((r) => (answer = r)));
    const { el, setState } = await mount();
    await act(async () => {
      // Two clicks in the same tick, as a double click delivers them.
      createBtn(el).click();
      createBtn(el).click();
    });
    expect(actions.googleSheetsCreateAction).toHaveBeenCalledTimes(1);
    await act(async () => answer(created));
    expect(actions.googleSheetsCreateAction).toHaveBeenCalledTimes(1);
    expect(setState).toHaveBeenCalledTimes(1);
  });

  it('shows a spinner and cannot be pressed while Google is answering, and neither can "choose"', async () => {
    let answer!: (v: unknown) => void;
    actions.googleSheetsCreateAction.mockImplementation(() => new Promise((r) => (answer = r)));
    const { el } = await mount({ pickerAvailable: true });
    await act(async () => createBtn(el).click());
    const b = createBtn(el);
    expect(b.disabled).toBe(true);
    expect(b.getAttribute('aria-busy')).toBe('true');
    expect(b.querySelector('.pi-spinner')).not.toBeNull();
    expect(b.textContent).toBe(m.gsheets.creatingSheet);
    expect(el.querySelector<HTMLButtonElement>('[data-testid="gsheets-choose"]')!.disabled).toBe(true);
    // A click during the slow answer does nothing.
    await act(async () => b.click());
    expect(actions.googleSheetsCreateAction).toHaveBeenCalledTimes(1);
    await act(async () => answer(created));
    expect(createBtn(el).disabled).toBe(false);
    expect(createBtn(el).getAttribute('aria-busy')).toBeNull();
  });

  it('can be pressed again after a failure', async () => {
    actions.googleSheetsCreateAction
      .mockResolvedValueOnce({ ok: true, data: { ok: false, reason: 'unavailable' } })
      .mockResolvedValueOnce(created);
    const { el, setState } = await mount();
    await act(async () => createBtn(el).click());
    expect(toasts.error).toHaveBeenCalledWith(m.gsheets.createFailed);
    await act(async () => createBtn(el).click());
    expect(actions.googleSheetsCreateAction).toHaveBeenCalledTimes(2);
    expect(setState).toHaveBeenCalledTimes(1);
  });

  it('a double click in the change flow opens one confirmation and creates one spreadsheet', async () => {
    actions.googleSheetsTabsAction.mockResolvedValue({
      ok: true,
      data: { enabled: true, spreadsheetTitle: 'Leads 2026', tabs: [] },
    });
    actions.googleSheetsCreateAction.mockResolvedValue(created);
    const { el } = await mount({
      state: { enabled: true, spreadsheetId: 'abc123', sheetTitle: '', columns: [] },
    });
    await act(async () => el.querySelector<HTMLButtonElement>('[data-testid="gsheets-change"]')!.click());
    await act(async () => {
      createBtn(el).click();
      createBtn(el).click();
    });
    expect(el.querySelectorAll('[data-testid="confirm-dialog"]').length).toBe(1);
    await act(async () => {
      const confirm = el.querySelector<HTMLButtonElement>('[data-testid="confirm-dialog-confirm"]')!;
      confirm.click();
      confirm.click();
    });
    expect(actions.googleSheetsCreateAction).toHaveBeenCalledTimes(1);
  });
});

/**
 * The buttons were grey pills (the `soft` variant): on a white card they read
 * as disabled, or as an afterthought. The first step is the app's primary
 * with an outlined alternative; everything else on the card is an outlined
 * secondary, and a disabled one both greys and fades.
 */
describe('the card\'s buttons read as buttons', () => {
  const classOf = (el: HTMLElement, id: string) => el.querySelector<HTMLElement>(`[data-testid="${id}"]`)!.className;

  it('with no sheet: "create" is the app\'s primary and "choose" the outlined secondary, both inline', async () => {
    const { el } = await mount({ pickerAvailable: true });
    // The app's own primary (the ink fill). Sheets green is kept for the one
    // button that opens the spreadsheet.
    expect(classOf(el, 'gsheets-create')).toContain('bg-primary');
    expect(classOf(el, 'gsheets-create')).toContain('text-primary-foreground');
    expect(classOf(el, 'gsheets-create')).not.toContain('#188038');
    expect(classOf(el, 'gsheets-choose')).toContain('border-input');
    expect(classOf(el, 'gsheets-choose')).toContain('bg-card');
    expect(classOf(el, 'gsheets-choose')).not.toContain('bg-primary');
    // The first step: no attached block, no "Change sheet".
    expect(el.querySelector('[data-testid="gsheets-attached"]')).toBeNull();
    expect(el.querySelector('[data-testid="gsheets-change"]')).toBeNull();
  });

  it('every other action is an outlined secondary, never the grey pill', async () => {
    const state: GoogleSheetsState = {
      enabled: true,
      spreadsheetId: 'abc123',
      sheetTitle: 'Responses',
      columns: [{ header: 'Email', source: 'answer', key: 'email' }],
    };
    const { el } = await mount({ state, formId: 'form-1' });
    for (const id of ['gsheets-change', 'gsheets-fill-from-form', 'gsheets-sync-headers', 'gsheets-add-column']) {
      const cls = classOf(el, id);
      expect(cls, id).toContain('border-input');
      expect(cls, id).toContain('bg-card');
      expect(cls, id).toContain('text-foreground');
      // `bg-muted` only as the DISABLED fill, never as the resting one.
      expect(cls.split(' ').includes('bg-muted'), id).toBe(false);
      expect(el.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)!.disabled, id).toBe(false);
    }
  });

  it('a disabled secondary greys AND fades, so it cannot pass for an enabled one', async () => {
    const { el } = await mount({ state: { ...EMPTY, columns: [{ header: 'Email', source: 'answer', key: 'email' }] }, formId: 'form-1' });
    const b = el.querySelector<HTMLButtonElement>('[data-testid="gsheets-sync-headers"]')!;
    expect(b.disabled).toBe(true);
    expect(b.className).toContain('disabled:bg-muted');
    expect(b.className).toContain('disabled:opacity-50');
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
    // The name is the strong element of the attached block, not the link's text.
    expect(el.querySelector('[data-testid="gsheets-attached-name"]')?.textContent).toBe('Leads 2026');
    const link = el.querySelector<HTMLAnchorElement>('[data-testid="gsheets-current"]')!;
    expect(link.textContent).toContain(m.gsheets.openSheetButton);
    expect(link.href).toBe('https://docs.google.com/spreadsheets/d/abc123/edit');
    // A button, not a stray underlined link, and it never hands Google this tab.
    expect(link.className).toContain('rounded-full');
    expect(link.className).not.toContain('underline');
    expect(link.target).toBe('_blank');
    expect(link.rel.split(' ').sort()).toEqual(['noopener', 'noreferrer']);
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
    const trigger = el.querySelector<HTMLButtonElement>(`button[aria-label="${m.gsheets.keyFor}"]`)!;
    expect(trigger.textContent).toBe('full_name');
    await act(async () => trigger.click());
    const options = [...el.querySelectorAll('[role="listbox"] [role="option"]')].map((o) => o.textContent);
    expect(options).toEqual(['full_name', 'Work email', 'Company']);
  });
});

describe('the column rows', () => {
  const COLUMNS = [
    { header: 'Submitted', source: 'submitted_at' as const },
    { header: 'Email', source: 'answer' as const, key: 'email' },
  ];

  it('uses the app’s own pickers, never a browser-default select', async () => {
    actions.googleSheetsTabsAction.mockResolvedValue({
      ok: true,
      data: { enabled: true, spreadsheetTitle: 'Leads', tabs: [{ title: 'Responses', gid: 0 }] },
    });
    const { el } = await mount({
      state: { ...EMPTY, spreadsheetId: 'abc123', sheetTitle: 'Responses', columns: COLUMNS },
    });
    expect(el.querySelectorAll('select')).toHaveLength(0);
    expect(el.querySelector(`button[aria-label="${m.gsheets.tabLabel}"]`)?.textContent).toBe('Responses');
    expect(el.querySelectorAll(`button[aria-label="${m.gsheets.sourceFor}"]`)).toHaveLength(2);
  });

  it('labels each row with the sheet’s column letter and gives its actions names', async () => {
    const { el } = await mount({ state: { ...EMPTY, spreadsheetId: 'abc123', columns: COLUMNS } });
    const rows = el.querySelectorAll('[data-testid="gsheets-column"]');
    expect([...rows].map((r) => r.firstElementChild?.textContent)).toEqual(['A', 'B']);
    expect(rows[0]!.querySelector(`button[aria-label="${m.gsheets.moveUp}"]`)?.hasAttribute('disabled')).toBe(true);
    expect(rows[1]!.querySelector(`button[aria-label="${m.gsheets.moveDown}"]`)?.hasAttribute('disabled')).toBe(true);
    expect(sheetColumnLetter(0)).toBe('A');
    expect(sheetColumnLetter(26)).toBe('AA');
  });
});

describe('the header row', () => {
  const STORED = { ...EMPTY, spreadsheetId: 'abc123', sheetTitle: 'Responses', columns: [{ header: 'Email', source: 'answer' as const, key: 'email' }] };

  it('names what the button does', async () => {
    const { el } = await mount({ state: STORED, formId: 'form-1' });
    expect(button(el, 'Update the header row')).toBeDefined();
  });

  it('syncs the form’s STORED columns, and reports what happened', async () => {
    const { el, onHeaderSync } = await mount({ state: STORED, formId: 'form-1' });
    actions.syncSheetHeadersAction.mockResolvedValueOnce({ ok: true, data: { ok: true, outcome: 'written' } });
    await act(async () => button(el, m.gsheets.writeHeaders)!.click());
    expect(actions.syncSheetHeadersAction).toHaveBeenCalledWith('form-1', false);
    expect(onHeaderSync).toHaveBeenCalledWith({ outcome: 'written' });
  });

  const MISMATCH = {
    outcome: 'foreign' as const,
    current: ['Submitted', 'Email', 'Company'],
    headers: ['Submitted', 'Work email'],
  };

  it('says plainly that row 1 does not match, and shows it beside what would be written', async () => {
    const { el } = await mount({ state: STORED, formId: 'form-1', headerSync: MISMATCH });
    const panel = el.querySelector('[data-testid="gsheets-header-mismatch"]')!;
    expect(panel.textContent).toContain(m.gsheets.headersNotEmpty);
    // Never the old, false claim about who wrote it.
    expect(panel.textContent).not.toMatch(/did not write/);
    const rows = [...panel.querySelectorAll('tbody tr')];
    expect(rows.map((r) => [...r.querySelectorAll('td')].map((td) => td.textContent))).toEqual([
      ['A', 'Submitted', 'Submitted'],
      ['B', 'Email', 'Work email'],
      ['C', 'Company', m.gsheets.headersEmptyCell],
    ]);
    expect(panel.querySelector('[data-testid="gsheets-replace-row"]')?.textContent).toBe(m.gsheets.replaceRow);
  });

  it('replaces row 1 only after the author confirms', async () => {
    actions.syncSheetHeadersAction.mockResolvedValue({ ok: true, data: { ok: true, outcome: 'written' } });
    const { el, onHeaderSync } = await mount({ state: STORED, formId: 'form-1', headerSync: MISMATCH });
    const dialogButton = (which: 'cancel' | 'confirm') =>
      el.querySelector<HTMLButtonElement>(`[data-testid="confirm-dialog-${which}"]`);

    await act(async () => el.querySelector<HTMLButtonElement>('[data-testid="gsheets-replace-row"]')!.click());
    expect(document.body.textContent).toContain(m.gsheets.replaceTitle);
    await act(async () => dialogButton('cancel')!.click());
    expect(actions.syncSheetHeadersAction).not.toHaveBeenCalledWith('form-1', true);

    await act(async () => el.querySelector<HTMLButtonElement>('[data-testid="gsheets-replace-row"]')!.click());
    await act(async () => dialogButton('confirm')!.click());
    expect(actions.syncSheetHeadersAction).toHaveBeenCalledWith('form-1', true);
    expect(onHeaderSync).toHaveBeenCalledWith({ outcome: 'written' });
  });

  it('looks at row 1 once when it opens, and shows a mismatch without a press', async () => {
    actions.syncSheetHeadersAction.mockResolvedValue({ ok: true, data: { ok: true, ...MISMATCH } });
    const { box, onHeaderSync } = await mount({ state: STORED, formId: 'form-1' });
    expect(actions.syncSheetHeadersAction).toHaveBeenCalledTimes(1);
    // A look: the check mode writes nothing and stores nothing.
    expect(actions.syncSheetHeadersAction).toHaveBeenCalledWith('form-1', 'check');
    expect(onHeaderSync).toHaveBeenCalledWith(MISMATCH);
    // A later render (any edit) does not ask Google again.
    await act(async () =>
      root!.render(
        <GoogleSheetsCard
          state={{ ...box.state, enabled: true }}
          setState={() => {}}
          questions={QUESTIONS}
          connected
          formId="form-1"
          onHeaderSync={onHeaderSync}
          locale="en"
          m={m}
        />,
      ),
    );
    expect(actions.syncSheetHeadersAction).toHaveBeenCalledTimes(1);
  });

  it('says nothing on open when row 1 already matches', async () => {
    const { onHeaderSync } = await mount({ state: STORED, formId: 'form-1' });
    expect(actions.syncSheetHeadersAction).toHaveBeenCalledTimes(1);
    expect(onHeaderSync).not.toHaveBeenCalled();
  });

  it('does not look before there is a spreadsheet, or without a connection', async () => {
    await mount({ state: { ...STORED, spreadsheetId: '' }, formId: 'form-1' });
    act(() => root?.unmount());
    container?.remove();
    await mount({ state: STORED, formId: 'form-1', connected: false });
    expect(actions.syncSheetHeadersAction).not.toHaveBeenCalled();
  });

  it('counts columns waiting for a heading, instead of claiming row 1 matches', async () => {
    const { el } = await mount({
      state: { ...STORED, columns: [...STORED.columns, { header: '', source: 'answer', key: 'company' }] },
      formId: 'form-1',
      headerSync: { outcome: 'unchanged' },
    });
    const line = el.querySelector('[data-testid="gsheets-header-sync"]')!;
    expect(line.textContent).toBe(m.gsheets.columnPendingOne);
    expect(line.getAttribute('data-tone')).toBe('info');
  });

  it('letters columns as the sheet does, and tells each row exactly what it needs', async () => {
    // A complete, B heading only, C complete, D no heading, E complete.
    const { el } = await mount({
      state: {
        ...STORED,
        columns: [
          { header: 'A', source: 'answer', key: 'email' },
          { header: 'B', source: 'answer' },
          { header: 'C', source: 'score' },
          { header: '', source: 'answer', key: 'company' },
          { header: 'E', source: 'utm' },
        ],
      },
      formId: 'form-1',
    });
    const letters = [...el.querySelectorAll('[data-testid="gsheets-column-letter"]')].map((l) => l.textContent);
    expect(letters).toEqual(['A', 'B', 'C', '', 'D']);
    const rows = [...el.querySelectorAll('[data-testid="gsheets-column"]')];
    const hint = (i: number) => rows[i]!.querySelector('[data-testid="gsheets-column-missing"]')?.textContent ?? null;
    expect(hint(0)).toBeNull();
    expect(hint(1)).toBe(m.gsheets.rowNeedsAnswer);
    expect(hint(2)).toBeNull();
    expect(hint(3)).toBe(m.gsheets.rowNeedsHeader);
    expect(hint(4)).toBe(m.gsheets.rowNeedsUtm);
  });

  // The author is renaming the middle column and has cleared its heading.
  // dForms wrote "B" there before, so the sheet keeps that position (an empty
  // cell under "B") and C stays under C. The card must count the same way:
  // the cleared column keeps its letter, and its note says what the sheet is
  // doing meanwhile. It used to lose its letter and C became "B" on the card,
  // as it did in the sheet.
  it('keeps the letter of a column whose heading was cleared, when the sheet still holds its place', async () => {
    const { el } = await mount({
      state: {
        ...STORED,
        writtenHeaders: ['A', 'B', 'C'],
        columns: [
          { header: 'A', source: 'answer', key: 'email' },
          { header: '', source: 'answer', key: 'company' },
          { header: 'C', source: 'score' },
          { header: '', source: 'answer', key: 'email' },
        ],
      },
      formId: 'form-1',
    });
    const letters = [...el.querySelectorAll('[data-testid="gsheets-column-letter"]')].map((l) => l.textContent);
    // Held column: B. The never-named one at the end: no letter.
    expect(letters).toEqual(['A', 'B', 'C', '']);
    const rows = [...el.querySelectorAll('[data-testid="gsheets-column"]')];
    const hint = (i: number) => rows[i]!.querySelector('[data-testid="gsheets-column-missing"]');
    expect(hint(1)?.textContent).toBe(m.gsheets.rowHeldHeader.replace('{header}', 'B'));
    expect(hint(1)?.getAttribute('data-held')).toBe('true');
    expect(hint(3)?.textContent).toBe(m.gsheets.rowNeedsHeader);
    expect(hint(3)?.getAttribute('data-held')).toBeNull();
  });

  it('gives that column no letter when dForms never wrote a row 1 for this sheet', async () => {
    const { el } = await mount({
      state: {
        ...STORED,
        writtenHeaders: null,
        columns: [
          { header: 'A', source: 'answer', key: 'email' },
          { header: '', source: 'answer', key: 'company' },
          { header: 'C', source: 'score' },
        ],
      },
      formId: 'form-1',
    });
    const letters = [...el.querySelectorAll('[data-testid="gsheets-column-letter"]')].map((l) => l.textContent);
    expect(letters).toEqual(['A', '', 'B']);
  });

  it('shows the row-1 mismatch above the column list', async () => {
    const { el } = await mount({ state: STORED, formId: 'form-1', headerSync: MISMATCH });
    const panel = el.querySelector('[data-testid="gsheets-header-mismatch"]')!;
    const list = el.querySelector('[data-testid="gsheets-column"]')!;
    expect(panel.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('offers to update a row 1 dForms wrote that fell out of date, in one press', async () => {
    const { el, onHeaderSync } = await mount({ state: STORED, formId: 'form-1', headerSync: { outcome: 'stale' } });
    const notice = el.querySelector('[data-testid="gsheets-header-stale"]')!;
    expect(notice.textContent).toContain(m.gsheets.headersStale);
    actions.syncSheetHeadersAction.mockResolvedValueOnce({ ok: true, data: { ok: true, outcome: 'written' } });
    await act(async () => notice.querySelector<HTMLButtonElement>('[data-testid="gsheets-update-stale"]')!.click());
    // No confirmation: it is the ordinary sync, which only rewrites a row it owns.
    expect(el.querySelector('[data-testid="confirm-dialog"]')).toBeNull();
    expect(actions.syncSheetHeadersAction).toHaveBeenLastCalledWith('form-1', false);
    expect(onHeaderSync).toHaveBeenCalledWith({ outcome: 'written' });
  });

  it('shows the out-of-date notice when the check on open finds it', async () => {
    actions.syncSheetHeadersAction.mockResolvedValue({ ok: true, data: { ok: true, outcome: 'stale' } });
    const { onHeaderSync } = await mount({ state: STORED, formId: 'form-1' });
    expect(onHeaderSync).toHaveBeenCalledWith({ outcome: 'stale' });
  });

  it('on a row 1 known not to match, the header button asks to replace it instead of doing nothing', async () => {
    const { el } = await mount({ state: STORED, formId: 'form-1', headerSync: MISMATCH });
    await act(async () => el.querySelector<HTMLButtonElement>('[data-testid="gsheets-sync-headers"]')!.click());
    expect(el.querySelector('[data-testid="confirm-dialog"]')).not.toBeNull();
    actions.syncSheetHeadersAction.mockResolvedValueOnce({ ok: true, data: { ok: true, outcome: 'written' } });
    await act(async () => el.querySelector<HTMLButtonElement>('[data-testid="confirm-dialog-confirm"]')!.click());
    expect(actions.syncSheetHeadersAction).toHaveBeenLastCalledWith('form-1', true);
  });

  it('only promises Google Drive where the Picker is there', async () => {
    const without = await mount({ pickerAvailable: false });
    expect(without.el.textContent).toContain(m.gsheets.sheetHelpCreateOnly);
    expect(without.el.textContent).not.toContain(m.gsheets.sheetHelp);
  });

  it('gives a disabled header button a disabled look', async () => {
    const { el } = await mount({ state: { ...EMPTY, columns: STORED.columns }, formId: 'form-1' });
    const b = el.querySelector<HTMLButtonElement>('[data-testid="gsheets-sync-headers"]')!;
    expect(b.disabled).toBe(true);
    expect(b.className).toContain('disabled:opacity-50');
  });

  it('says so in the destructive tone when the update failed', async () => {
    const { el } = await mount({
      state: STORED,
      formId: 'form-1',
      headerSync: { outcome: 'failed', reason: 'unavailable' },
    });
    expect(el.querySelector('[data-testid="gsheets-header-sync"]')?.getAttribute('data-tone')).toBe('error');
  });
});
