import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LEAD_DATALAYER_EVENT, LEAD_PIXEL_EVENT, leadReportedKey } from './lead-conversion';

const SESSION_KEY = 'quill-form-acct1-my-form';
const SESSION_ID = 'a1b2c3';

type Storage = {
  store: Map<string, string>;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

/** A `sessionStorage` that behaves, or one that refuses (blocked site data). */
function stubStorage(opts: { blocked?: boolean } = {}): Storage {
  const store = new Map<string, string>();
  return {
    store,
    getItem(key) {
      if (opts.blocked) throw new Error('storage is disabled');
      return store.get(key) ?? null;
    },
    setItem(key, value) {
      if (opts.blocked) throw new Error('storage is disabled');
      store.set(key, value);
    },
  };
}

/**
 * A fake window carrying only what this module looks at. `fbq` and `dataLayer`
 * are opt-in exactly as they are in the browser: a form with no pixel and no
 * GTM container has neither.
 */
function stubWindow(
  opts: {
    fbq?: 'broken' | false;
    dataLayer?: unknown[] | 'not-an-array' | false;
    storage?: Storage;
  } = {},
) {
  const calls: unknown[][] = [];
  const storage = opts.storage ?? stubStorage();
  const win: Record<string, unknown> = { sessionStorage: storage };

  if (opts.fbq === 'broken') {
    win.fbq = () => {
      throw new Error('vendor stub exploded');
    };
  } else if (opts.fbq !== false) {
    win.fbq = (...args: unknown[]) => {
      calls.push(args);
    };
  }

  if (opts.dataLayer === 'not-an-array') win.dataLayer = {};
  else if (opts.dataLayer !== false) win.dataLayer = opts.dataLayer ?? [];

  vi.stubGlobal('window', win);
  return { calls, storage, win };
}

/**
 * The module holds a per-document lock in module scope, so every test gets its
 * own copy: a fresh import IS a fresh document. Re-importing mid-test is
 * therefore how a reload is simulated: module state gone, `sessionStorage` kept.
 */
type Module = typeof import('./lead-conversion');
let mod: Module;
const loadModule = (): Promise<Module> => import('./lead-conversion');

beforeEach(async () => {
  vi.resetModules();
  mod = await loadModule();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('reportLeadConversion', () => {
  it('fires the Meta Lead event once and pushes the same conversion to GTM', () => {
    const dataLayer: unknown[] = [];
    const { calls } = stubWindow({ dataLayer });

    expect(mod.reportLeadConversion({ sessionKey: SESSION_KEY, sessionId: SESSION_ID })).toBe(true);

    expect(calls).toEqual([['track', LEAD_PIXEL_EVENT]]);
    expect(dataLayer).toEqual([{ event: LEAD_DATALAYER_EVENT }]);
  });

  it('marks the session so a second call reports nothing', () => {
    const dataLayer: unknown[] = [];
    const { calls, storage } = stubWindow({ dataLayer });

    mod.reportLeadConversion({ sessionKey: SESSION_KEY, sessionId: SESSION_ID });
    expect(storage.store.get(leadReportedKey(SESSION_KEY))).toBe(SESSION_ID);

    expect(mod.reportLeadConversion({ sessionKey: SESSION_KEY, sessionId: SESSION_ID })).toBe(
      false,
    );
    expect(calls).toHaveLength(1);
    expect(dataLayer).toHaveLength(1);
  });

  it('stays quiet after a RELOAD, which a useRef could not have done', async () => {
    const { calls } = stubWindow();
    mod.reportLeadConversion({ sessionKey: SESSION_KEY, sessionId: SESSION_ID });

    // New document, same tab: module state is gone, sessionStorage is not.
    vi.resetModules();
    const reloaded = await loadModule();
    expect(reloaded.reportLeadConversion({ sessionKey: SESSION_KEY, sessionId: SESSION_ID })).toBe(
      false,
    );
    expect(calls).toHaveLength(1);
  });

  it('reports again for a genuinely new session of the same form', () => {
    const { calls } = stubWindow();
    mod.reportLeadConversion({ sessionKey: SESSION_KEY, sessionId: SESSION_ID });
    expect(mod.reportLeadConversion({ sessionKey: SESSION_KEY, sessionId: 'second-visit' })).toBe(
      true,
    );
    expect(calls).toHaveLength(2);
  });

  it('keeps two forms in one tab independent', () => {
    const { calls } = stubWindow();
    mod.reportLeadConversion({ sessionKey: SESSION_KEY, sessionId: SESSION_ID });
    expect(
      mod.reportLeadConversion({ sessionKey: 'quill-form-acct1-other', sessionId: 'other-id' }),
    ).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it('never writes the mark into another form\'s session key', () => {
    // Slugs carry hyphens and are editable, so `demo` and `demo-lead` can both
    // exist in one account. With a `-` separator the first form's mark WAS the
    // second form's session key, and reporting a lead on `demo` overwrote the
    // live session id of `demo-lead` in the same tab.
    const { storage } = stubWindow();
    const demo = 'quill-form-acct1-demo';
    const demoLead = 'quill-form-acct1-demo-lead';
    storage.setItem(demoLead, 'the-other-forms-session');

    mod.reportLeadConversion({ sessionKey: demo, sessionId: SESSION_ID });

    expect(leadReportedKey(demo)).not.toBe(demoLead);
    expect(storage.store.get(demoLead)).toBe('the-other-forms-session');
  });

  it('still locks within the document when storage is blocked outright', () => {
    const { calls } = stubWindow({ storage: stubStorage({ blocked: true }) });
    expect(mod.reportLeadConversion({ sessionKey: SESSION_KEY, sessionId: SESSION_ID })).toBe(true);
    expect(mod.reportLeadConversion({ sessionKey: SESSION_KEY, sessionId: SESSION_ID })).toBe(
      false,
    );
    expect(calls).toHaveLength(1);
  });
});

describe('reportLeadConversion with nothing configured', () => {
  it('makes no request and does not throw when there is no pixel', () => {
    const dataLayer: unknown[] = [];
    stubWindow({ fbq: false, dataLayer });
    expect(mod.reportLeadConversion({ sessionKey: SESSION_KEY, sessionId: SESSION_ID })).toBe(true);
    expect(dataLayer).toEqual([{ event: LEAD_DATALAYER_EVENT }]);
  });

  it('does not create a dataLayer the public page never initialized', () => {
    const { win, calls } = stubWindow({ dataLayer: false });
    expect(mod.reportLeadConversion({ sessionKey: SESSION_KEY, sessionId: SESSION_ID })).toBe(true);
    expect(win.dataLayer).toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it('leaves a dataLayer that is not an array alone', () => {
    const { win } = stubWindow({ dataLayer: 'not-an-array' });
    expect(() =>
      mod.reportLeadConversion({ sessionKey: SESSION_KEY, sessionId: SESSION_ID }),
    ).not.toThrow();
    expect(win.dataLayer).toEqual({});
  });

  it('survives a vendor stub that throws, so the submit is never stranded', () => {
    const dataLayer: unknown[] = [];
    stubWindow({ fbq: 'broken', dataLayer });
    expect(() =>
      mod.reportLeadConversion({ sessionKey: SESSION_KEY, sessionId: SESSION_ID }),
    ).not.toThrow();
    // The pixel blew up; the GTM push still happened.
    expect(dataLayer).toEqual([{ event: LEAD_DATALAYER_EVENT }]);
  });
});

describe('reportLeadConversion preconditions', () => {
  it('does nothing without a session id (server render, or no session yet)', () => {
    const { calls } = stubWindow();
    expect(mod.reportLeadConversion({ sessionKey: SESSION_KEY, sessionId: '' })).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('does nothing without a session key', () => {
    const { calls } = stubWindow();
    expect(mod.reportLeadConversion({ sessionKey: '', sessionId: SESSION_ID })).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('is inert on the server, with no window at all', () => {
    vi.stubGlobal('window', undefined);
    expect(mod.reportLeadConversion({ sessionKey: SESSION_KEY, sessionId: SESSION_ID })).toBe(
      false,
    );
  });
});
