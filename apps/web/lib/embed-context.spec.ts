/**
 * `public/embed.js` answering `dapta-forms:context-request` (#199): the page an
 * embedded form sits on, read on the host page where the frame cannot read it.
 *
 * The script is plain ES5 with no build step, so the file itself runs here, in
 * a `vm` context with a fake host window and document: the cookie jar, the
 * title, `hsVars` and the frames are all in the test's hands, and nothing is
 * loaded from anywhere.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const SCRIPT = readFileSync(path.resolve(__dirname, '../public/embed.js'), 'utf8');

const FORM_ORIGIN = 'https://forms.example.com';
const SRC = `${FORM_ORIGIN}/acme/f/quote?embed=1`;
const LANDING = 'https://landing.example.com/offer?utm_source=facebook&utm_medium=paid_social&fbclid=abc';
const HUTK = '0123456789abcdef0123456789ABCDEF';

type Reply = { message: Record<string, unknown>; targetOrigin: string };

function fakeFrame(src: string, attrs: Record<string, string> = {}) {
  const posted: Reply[] = [];
  return {
    posted,
    src,
    style: {} as Record<string, string>,
    getAttribute: (name: string) => attrs[name] ?? null,
    contentWindow: {
      postMessage: (message: Record<string, unknown>, targetOrigin: string) => posted.push({ message, targetOrigin }),
    },
  };
}

/** A host page running embed.js. */
function hostPage(opts: {
  cookie?: string;
  title?: string;
  hsVars?: Record<string, unknown>;
  loaderSrc?: string;
  frames?: ReturnType<typeof fakeFrame>[];
}) {
  const listeners: Array<(e: unknown) => void> = [];
  const cookieWrites: string[] = [];
  let jar = opts.cookie ?? '';
  const frames = opts.frames ?? [fakeFrame(SRC)];
  const window = {
    location: { href: LANDING },
    innerHeight: 900,
    hsVars: opts.hsVars,
    matchMedia: () => ({ matches: false }),
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      if (type === 'message') listeners.push(fn);
    },
  };
  const document = {
    title: opts.title ?? 'Home insurance | Example Insurance',
    get cookie() {
      return jar;
    },
    set cookie(value: string) {
      cookieWrites.push(value);
      jar = value;
    },
    documentElement: { clientHeight: 900 },
    querySelectorAll: (selector: string) => (selector === 'iframe[data-dapta-forms]' ? frames : []),
    getElementById: (id: string) => (id === 'hs-script-loader' && opts.loaderSrc ? { src: opts.loaderSrc } : null),
  };
  vm.runInContext(SCRIPT, vm.createContext({ window, document, URL }));

  /** A message reaching the host page's window. */
  const send = (data: unknown, source: unknown, origin = FORM_ORIGIN) => {
    for (const fn of listeners) fn({ data, source, origin });
  };
  const ask = (frame = frames[0]!, extra: Record<string, unknown> = {}, origin = FORM_ORIGIN) =>
    send({ type: 'dapta-forms:context-request', id: 'nonce-1', v: 1, ...extra }, frame.contentWindow, origin);
  return { frames, send, ask, cookieWrites };
}

describe('embed.js: dapta-forms:context-request', () => {
  it('answers our frame with the page as it is now, targeted at the origin of its src', () => {
    const page = hostPage({ cookie: `a=1; hubspotutk=${HUTK}; b=2`, hsVars: { page_id: 98765, portal_id: 4321 } });
    page.ask();
    expect(page.frames[0]!.posted).toEqual([
      {
        message: {
          type: 'dapta-forms:context',
          id: 'nonce-1',
          v: 1,
          pageUri: LANDING,
          pageName: 'Home insurance | Example Insurance',
          pageId: '98765',
          hsPortalId: '4321',
          hutk: HUTK,
        },
        targetOrigin: FORM_ORIGIN,
      },
    ]);
  });

  it('reads the portal from the HubSpot tracking code on a page that is not a HubSpot page', () => {
    const page = hostPage({ loaderSrc: 'https://js.hs-scripts.com/4321.js' });
    page.ask();
    const reply = page.frames[0]!.posted[0]!.message;
    expect(reply.hsPortalId).toBe('4321');
    expect(reply).not.toHaveProperty('pageId');
    expect(reply).not.toHaveProperty('hutk'); // no cookie on this page
  });

  it('never answers a frame that is not ours', () => {
    const stranger = fakeFrame(SRC);
    const page = hostPage({ cookie: `hubspotutk=${HUTK}` });
    page.send({ type: 'dapta-forms:context-request', id: 'nonce-1', v: 1 }, stranger.contentWindow);
    page.send({ type: 'dapta-forms:context-request', id: 'nonce-1', v: 1 }, {});
    expect(page.frames[0]!.posted).toEqual([]);
    expect(stranger.posted).toEqual([]);
  });

  it('never answers our frame once it shows another origin than its src', () => {
    const page = hostPage({ cookie: `hubspotutk=${HUTK}` });
    page.ask(undefined, {}, 'https://elsewhere.example.com');
    page.ask(undefined, {}, 'null'); // a sandboxed frame has an opaque origin
    expect(page.frames[0]!.posted).toEqual([]);
  });

  it('leaves the cookie out when the visitor opted out of HubSpot tracking, and keeps the page', () => {
    for (const optOut of ['__hs_opt_out=yes', '__hs_do_not_track=1']) {
      const page = hostPage({ cookie: `hubspotutk=${HUTK}; ${optOut}` });
      page.ask();
      const reply = page.frames[0]!.posted[0]!.message;
      expect(reply, optOut).not.toHaveProperty('hutk');
      expect(reply.pageUri).toBe(LANDING);
    }
  });

  it('leaves out a cookie that is not HubSpot shaped', () => {
    const page = hostPage({ cookie: 'hubspotutk=abc' });
    page.ask();
    expect(page.frames[0]!.posted[0]!.message).not.toHaveProperty('hutk');
  });

  it('answers only "off" for a frame the page switched off', () => {
    const off = fakeFrame(SRC, { 'data-dapta-forms-context': 'off' });
    const page = hostPage({ cookie: `hubspotutk=${HUTK}`, frames: [off] });
    page.ask(off);
    expect(off.posted).toEqual([
      { message: { type: 'dapta-forms:context', id: 'nonce-1', v: 1, off: true }, targetOrigin: FORM_ORIGIN },
    ]);
  });

  it('answers the right frame when two forms share a page', () => {
    const second = fakeFrame('https://other-forms.example.net/acme/f/two?embed=1');
    const page = hostPage({ frames: [fakeFrame(SRC), second] });
    page.ask(second, {}, 'https://other-forms.example.net');
    expect(page.frames[0]!.posted).toEqual([]);
    expect(second.posted[0]!.targetOrigin).toBe('https://other-forms.example.net');
  });

  it('ignores a request that is not in the version-1 shape', () => {
    const page = hostPage({});
    page.ask(undefined, { v: 2 });
    page.ask(undefined, { id: undefined });
    page.ask(undefined, { id: 'x'.repeat(65) });
    expect(page.frames[0]!.posted).toEqual([]);
  });

  it('never writes a cookie', () => {
    const page = hostPage({ cookie: `hubspotutk=${HUTK}; __hs_opt_out=no` });
    page.ask();
    page.ask(undefined, { id: 'nonce-2' });
    expect(page.cookieWrites).toEqual([]);
  });

  it('keeps sizing the frame as before', () => {
    const page = hostPage({});
    page.send({ type: 'dapta-forms:resize', height: 640 }, page.frames[0]!.contentWindow);
    expect(page.frames[0]!.style.height).toBe('640px');
  });
});
