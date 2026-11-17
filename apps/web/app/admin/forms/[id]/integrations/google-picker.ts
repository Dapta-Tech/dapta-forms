/**
 * Google's Picker, the file chooser Google itself draws.
 *
 * Why a form needs it at all: the app asks Google only for the `drive.file`
 * scope, which reaches the files the app created and the files the user HANDS
 * it. Choosing a spreadsheet in the Picker is that hand-over. There is no other
 * way to point a form at a spreadsheet that already exists, which is also why
 * there is no "paste the link" field: a pasted id would be refused by Google
 * exactly as if the file had been deleted.
 *
 * The grant only happens when the Picker is built with the app id of the Cloud
 * project that owns the OAuth client. Without `setAppId` the Picker still opens
 * and still returns a file, and every later write to that file is refused. That
 * failure is silent at pick time, so the app id is not optional here.
 */

const PICKER_SCRIPT = 'https://apis.google.com/js/api.js';

/** The spreadsheet somebody chose. */
export interface PickedSpreadsheet {
  id: string;
  name: string;
}

export interface PickerConfig {
  /** Short-lived, minted by the API for this one open. Never kept in state. */
  accessToken: string;
  /** Browser key, restricted by referrer on Google's side. */
  apiKey: string;
  /** The Cloud project number that owns the OAuth client. */
  appId: string;
  /** Two-letter UI language for the Picker's own chrome. */
  locale?: string;
}

/** Just enough of `google.picker` to build one. Google ships no types for it. */
interface PickerBuilder {
  addView(view: unknown): PickerBuilder;
  setOAuthToken(token: string): PickerBuilder;
  setDeveloperKey(key: string): PickerBuilder;
  setAppId(id: string): PickerBuilder;
  setLocale(locale: string): PickerBuilder;
  setCallback(cb: (data: PickerResult) => void): PickerBuilder;
  build(): { setVisible(visible: boolean): void };
}
interface DocsView {
  setIncludeFolders(include: boolean): DocsView;
  setSelectFolderEnabled(enabled: boolean): DocsView;
  setMode(mode: unknown): DocsView;
}
interface PickerNamespace {
  PickerBuilder: new () => PickerBuilder;
  DocsView: new (viewId: unknown) => DocsView;
  ViewId: { SPREADSHEETS: unknown };
  DocsViewMode?: { LIST: unknown };
  Action: { PICKED: string; CANCEL: string };
}
interface PickerResult {
  action: string;
  docs?: Array<{ id?: unknown; name?: unknown }>;
}
interface GoogleGlobals {
  gapi?: { load(name: string, cb: () => void): void };
  google?: { picker?: PickerNamespace };
}

/** One load per page: a second click must not append the script again. */
let loading: Promise<void> | null = null;

/** Load Google's loader script and, through it, the Picker module. */
export function loadPicker(
  win: GoogleGlobals = window as unknown as GoogleGlobals,
  doc: Document = document,
): Promise<void> {
  if (win.google?.picker) return Promise.resolve();
  if (loading) return loading;
  const attempt = new Promise<void>((resolve, reject) => {
    const ready = () => {
      if (!win.gapi) return reject(new Error('gapi missing'));
      win.gapi.load('picker', () =>
        win.google?.picker ? resolve() : reject(new Error('picker missing')),
      );
    };
    if (win.gapi) return ready();
    const script = doc.createElement('script');
    script.src = PICKER_SCRIPT;
    script.async = true;
    script.onload = ready;
    script.onerror = () => reject(new Error('picker script failed to load'));
    doc.head.appendChild(script);
  });
  // A failed load is forgotten, so the next click tries again instead of
  // replaying a rejection from a network blip for the life of the page.
  loading = attempt.catch((err) => {
    loading = null;
    throw err;
  });
  return loading;
}

/**
 * Open the Picker on the account's spreadsheets.
 *
 * Resolves with the chosen spreadsheet, or null when the dialog was closed
 * without choosing. Rejects only when the Picker could not be loaded at all.
 */
export async function pickSpreadsheet(
  config: PickerConfig,
  win: GoogleGlobals = window as unknown as GoogleGlobals,
  doc: Document = document,
): Promise<PickedSpreadsheet | null> {
  await loadPicker(win, doc);
  const picker = win.google!.picker!;
  return new Promise((resolve) => {
    const view = new picker.DocsView(picker.ViewId.SPREADSHEETS)
      .setIncludeFolders(false)
      .setSelectFolderEnabled(false);
    if (picker.DocsViewMode) view.setMode(picker.DocsViewMode.LIST);
    const builder = new picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(config.accessToken)
      .setDeveloperKey(config.apiKey)
      .setAppId(config.appId)
      .setCallback((data) => {
        if (data.action === picker.Action.PICKED) {
          const doc0 = data.docs?.[0];
          const id = typeof doc0?.id === 'string' ? doc0.id : '';
          // A pick with no id is treated as no pick: storing an empty id would
          // look configured and deliver nowhere.
          resolve(id ? { id, name: typeof doc0?.name === 'string' ? doc0.name : '' } : null);
        } else if (data.action === picker.Action.CANCEL) {
          resolve(null);
        }
        // Every other action ("loaded", ...) is the Picker narrating itself.
      });
    if (config.locale) builder.setLocale(config.locale);
    builder.build().setVisible(true);
  });
}

/** Spec seam: forget a load in flight. */
export function resetPickerForTests(): void {
  loading = null;
}
