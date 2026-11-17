// @vitest-environment happy-dom
/**
 * The wrapper around Google's Picker.
 *
 * The one promise that matters most cannot be seen at pick time, which is why
 * it is pinned here: the Picker must be built with the app id. Without it the
 * dialog opens, a file is chosen, everything looks right, and every write to
 * that file is then refused, because choosing it granted this app nothing.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadPicker, pickSpreadsheet, resetPickerForTests } from './google-picker';

const CONFIG = { accessToken: 'ya29.token', apiKey: 'browser-key', appId: '123456789012', locale: 'es' };

/** A stand-in for `google.picker` that records how it was built. */
function fakeGoogle() {
  const built: Record<string, unknown> = {};
  let callback: (data: unknown) => void = () => {};
  const view = { includeFolders: null as boolean | null, mode: null as unknown };
  class DocsView {
    constructor(public viewId: unknown) {
      built.viewId = viewId;
    }
    setIncludeFolders(v: boolean) {
      view.includeFolders = v;
      return this;
    }
    setSelectFolderEnabled() {
      return this;
    }
    setMode(m: unknown) {
      view.mode = m;
      return this;
    }
  }
  class PickerBuilder {
    addView() {
      return this;
    }
    setOAuthToken(v: string) {
      built.token = v;
      return this;
    }
    setDeveloperKey(v: string) {
      built.key = v;
      return this;
    }
    setAppId(v: string) {
      built.appId = v;
      return this;
    }
    setLocale(v: string) {
      built.locale = v;
      return this;
    }
    setCallback(cb: (data: unknown) => void) {
      callback = cb;
      return this;
    }
    build() {
      return { setVisible: (v: boolean) => (built.visible = v) };
    }
  }
  const picker = {
    PickerBuilder,
    DocsView,
    ViewId: { SPREADSHEETS: 'spreadsheets' },
    DocsViewMode: { LIST: 'list' },
    Action: { PICKED: 'picked', CANCEL: 'cancel' },
  };
  return { win: { google: { picker } } as never, built, view, fire: (data: unknown) => callback(data) };
}

afterEach(() => resetPickerForTests());

describe('pickSpreadsheet', () => {
  it('builds the Picker with the token, the key and the app id', async () => {
    const g = fakeGoogle();
    const pending = pickSpreadsheet(CONFIG, g.win, document);
    await Promise.resolve();
    g.fire({ action: 'cancel' });
    await pending;
    expect(g.built).toMatchObject({
      token: 'ya29.token',
      key: 'browser-key',
      appId: '123456789012',
      locale: 'es',
      visible: true,
    });
  });

  it('lists spreadsheets only, not folders or other files', async () => {
    const g = fakeGoogle();
    const pending = pickSpreadsheet(CONFIG, g.win, document);
    await Promise.resolve();
    g.fire({ action: 'cancel' });
    await pending;
    expect(g.built.viewId).toBe('spreadsheets');
    expect(g.view.includeFolders).toBe(false);
  });

  it('resolves with the spreadsheet that was chosen', async () => {
    const g = fakeGoogle();
    const pending = pickSpreadsheet(CONFIG, g.win, document);
    await Promise.resolve();
    g.fire({ action: 'picked', docs: [{ id: 'sheet-1', name: 'Leads 2026' }] });
    expect(await pending).toEqual({ id: 'sheet-1', name: 'Leads 2026' });
  });

  it('resolves with nothing when the dialog is closed', async () => {
    const g = fakeGoogle();
    const pending = pickSpreadsheet(CONFIG, g.win, document);
    await Promise.resolve();
    g.fire({ action: 'cancel' });
    expect(await pending).toBeNull();
  });

  it('keeps waiting through the actions that are not an answer', async () => {
    const g = fakeGoogle();
    let settled = false;
    const pending = pickSpreadsheet(CONFIG, g.win, document).then((v) => {
      settled = true;
      return v;
    });
    await Promise.resolve();
    g.fire({ action: 'loaded' });
    await Promise.resolve();
    expect(settled).toBe(false);
    g.fire({ action: 'picked', docs: [{ id: 'sheet-2', name: 'x' }] });
    expect(await pending).toEqual({ id: 'sheet-2', name: 'x' });
  });

  it('treats a pick with no id as no pick, rather than storing an empty one', async () => {
    const g = fakeGoogle();
    const pending = pickSpreadsheet(CONFIG, g.win, document);
    await Promise.resolve();
    g.fire({ action: 'picked', docs: [{ name: 'no id here' }] });
    expect(await pending).toBeNull();
  });
});

describe('loadPicker', () => {
  it('does nothing when the Picker is already on the page', async () => {
    const g = fakeGoogle();
    const append = vi.spyOn(document.head, 'appendChild');
    await loadPicker(g.win, document);
    expect(append).not.toHaveBeenCalled();
    append.mockRestore();
  });

  it('adds the loader script once, however many times it is asked', async () => {
    const win = {} as { gapi?: unknown; google?: unknown };
    const added: HTMLScriptElement[] = [];
    const append = vi.spyOn(document.head, 'appendChild').mockImplementation((node) => {
      added.push(node as HTMLScriptElement);
      return node;
    });
    const first = loadPicker(win as never, document);
    const second = loadPicker(win as never, document);
    expect(added).toHaveLength(1);
    expect(added[0]!.src).toBe('https://apis.google.com/js/api.js');

    // The script arrives, and through it the Picker module.
    const g = fakeGoogle();
    win.gapi = {
      load: (_name: string, cb: () => void) => {
        win.google = (g.win as { google: unknown }).google;
        cb();
      },
    };
    added[0]!.onload!(new Event('load'));
    await expect(Promise.all([first, second])).resolves.toBeDefined();
    append.mockRestore();
  });

  it('forgets a failed load, so the next click tries again', async () => {
    const win = {} as never;
    const added: HTMLScriptElement[] = [];
    const append = vi.spyOn(document.head, 'appendChild').mockImplementation((node) => {
      added.push(node as HTMLScriptElement);
      return node;
    });
    const first = loadPicker(win, document);
    added[0]!.onerror!(new Event('error'));
    await expect(first).rejects.toThrow();

    void loadPicker(win, document).catch(() => {});
    expect(added).toHaveLength(2);
    append.mockRestore();
  });
});
