import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createHostVisit,
  hostUtm,
  CONTEXT_REPLY,
  CONTEXT_REQUEST,
  CONTEXT_VERSION,
  HOST_WAIT_MS,
  MOUNT_RETRY_MS,
  SILENT_WAIT_MS,
} from './host-visit';

type Posted = { message: { type: string; id: string; v: number }; targetOrigin: string };

const HUTK = '0123456789abcdef0123456789abcdef';
const FORM_TITLE = 'Quote request';
const LANDING = 'https://landing.example.com/offer?utm_source=facebook&utm_medium=paid_social&fbclid=abc';

/**
 * A fake window: `framed` decides whether `top` differs from `self`. The
 * parent records what the frame posts to it; `answer` plays the host page's
 * embed.js replying to the last request.
 */
function stubWindow(opts: {
  framed: boolean;
  href?: string;
  cookie?: string;
  referrer?: string;
}) {
  const posted: Posted[] = [];
  const listeners: Array<(e: MessageEvent) => void> = [];
  const self: Record<string, unknown> = {};
  const parent = {
    postMessage: (message: Posted['message'], targetOrigin: string) => posted.push({ message, targetOrigin }),
  };
  Object.assign(self, {
    self,
    top: opts.framed ? {} : self,
    parent: opts.framed ? parent : self,
    location: { href: opts.href ?? 'https://forms.example.com/acme/f/quote' },
    addEventListener: (type: string, fn: (e: MessageEvent) => void) => {
      if (type === 'message') listeners.push(fn);
    },
    removeEventListener: (type: string, fn: (e: MessageEvent) => void) => {
      const i = listeners.indexOf(fn);
      if (type === 'message' && i >= 0) listeners.splice(i, 1);
    },
  });
  vi.stubGlobal('window', self);
  vi.stubGlobal('document', { cookie: opts.cookie ?? '', referrer: opts.referrer ?? '' });

  const deliver = (data: unknown, source: unknown = parent) => {
    for (const fn of [...listeners]) fn({ data, source } as unknown as MessageEvent);
  };
  /** The host page answering the most recent request. */
  const answer = (fields: Record<string, unknown>, id = posted.at(-1)?.message.id) =>
    deliver({ type: CONTEXT_REPLY, id, v: CONTEXT_VERSION, ...fields });

  return { posted, listeners, deliver, answer, parent };
}

const hostFields = { pageUri: LANDING, pageName: 'Home insurance', hutk: HUTK, pageId: '12345', hsPortalId: '4321' };

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('createHostVisit: embedded, with the host script on the page', () => {
  it('asks the host at mount with a nonce, to any origin, and again at 1 s and 3 s until it answers', () => {
    const w = stubWindow({ framed: true });
    createHostVisit({ hubspotTracking: false, formTitle: FORM_TITLE }).start();
    expect(w.posted).toHaveLength(1);
    expect(w.posted[0]!.message).toEqual({ type: CONTEXT_REQUEST, id: expect.any(String), v: CONTEXT_VERSION });
    expect(w.posted[0]!.message.id.length).toBeGreaterThanOrEqual(16);
    // Nothing that identifies anyone crosses: the host is by definition unknown.
    expect(w.posted[0]!.targetOrigin).toBe('*');

    vi.advanceTimersByTime(MOUNT_RETRY_MS[0]);
    expect(w.posted).toHaveLength(2);
    expect(w.posted[1]!.message.id).not.toBe(w.posted[0]!.message.id);
    w.answer(hostFields);
    vi.advanceTimersByTime(MOUNT_RETRY_MS[1]);
    expect(w.posted).toHaveLength(2); // it answered: no third ask
  });

  it('asks afresh at submit and sends what the host says NOW, with its campaign', async () => {
    const w = stubWindow({ framed: true });
    const visit = createHostVisit({ hubspotTracking: false, formTitle: FORM_TITLE });
    visit.start();
    w.answer({ pageUri: 'https://landing.example.com/old', pageName: 'Old' });

    const pending = visit.resolve();
    expect(w.posted).toHaveLength(2);
    w.answer(hostFields);
    await expect(pending).resolves.toEqual({
      visit: {
        pageUri: LANDING,
        pageName: 'Home insurance',
        hutk: HUTK,
        pageId: '12345',
        hsPortalId: '4321',
        embedded: true,
      },
      hostUtm: { utm_source: 'facebook', utm_medium: 'paid_social' },
    });
  });

  it('waits at most 500 ms for a host that answered before, then uses what it said', async () => {
    const w = stubWindow({ framed: true });
    const visit = createHostVisit({ hubspotTracking: false, formTitle: FORM_TITLE });
    visit.start();
    w.answer(hostFields);

    let done = false;
    const pending = visit.resolve().then((r) => {
      done = true;
      return r;
    });
    await vi.advanceTimersByTimeAsync(HOST_WAIT_MS - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((await pending)?.visit.hutk).toBe(HUTK);
  });

  it('ignores an answer from anything but its parent, or to another request', async () => {
    const w = stubWindow({ framed: true });
    const visit = createHostVisit({ hubspotTracking: false, formTitle: FORM_TITLE });
    visit.start();
    w.answer(hostFields);
    const pending = visit.resolve();
    const id = w.posted.at(-1)!.message.id;
    // A frame beside ours, and a reply to a request nobody made.
    w.deliver({ type: CONTEXT_REPLY, id, v: CONTEXT_VERSION, pageUri: 'https://evil.example.com/' }, {});
    w.answer({ pageUri: 'https://evil.example.com/' }, 'not-our-nonce');
    w.deliver({ type: CONTEXT_REPLY, id, v: 2, pageUri: 'https://evil.example.com/' });
    await vi.advanceTimersByTimeAsync(HOST_WAIT_MS);
    expect((await pending)?.visit.pageUri).toBe(LANDING); // the cached, trusted answer
  });

  it('leaves an untitled landing untitled: the form title is not the page', async () => {
    const w = stubWindow({ framed: true });
    const visit = createHostVisit({ hubspotTracking: false, formTitle: FORM_TITLE });
    visit.start();
    const pending = visit.resolve();
    w.answer({ pageUri: 'https://landing.example.com/', pageName: '   ' });
    expect((await pending)?.visit).toEqual({ pageUri: 'https://landing.example.com/', embedded: true });
  });

  it('drops a cookie that is not HubSpot shaped, and sends the rest', async () => {
    const w = stubWindow({ framed: true });
    const visit = createHostVisit({ hubspotTracking: false, formTitle: FORM_TITLE });
    const pending = visit.resolve();
    w.answer({ ...hostFields, hutk: 'abc' });
    const resolved = await pending;
    expect(resolved?.visit).not.toHaveProperty('hutk');
    expect(resolved?.visit.pageUri).toBe(LANDING);
  });

  it('sends nothing at all once the page switched the context off', async () => {
    const w = stubWindow({ framed: true });
    const visit = createHostVisit({ hubspotTracking: false, formTitle: FORM_TITLE });
    visit.start();
    w.answer({ off: true });
    await expect(visit.resolve()).resolves.toBeUndefined();
    expect(w.posted).toHaveLength(1); // not even asked again
  });
});

describe('createHostVisit: embedded, with nothing answering', () => {
  it('pays at most 150 ms, then falls back to the referrer as the page, with no cookie', async () => {
    stubWindow({ framed: true, referrer: 'https://landing.example.com/' });
    const visit = createHostVisit({ hubspotTracking: true, formTitle: FORM_TITLE });
    let done = false;
    const pending = visit.resolve().then((r) => {
      done = true;
      return r;
    });
    await vi.advanceTimersByTimeAsync(SILENT_WAIT_MS - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toEqual({
      visit: { pageUri: 'https://landing.example.com/', embedded: true },
      hostUtm: {},
    });
  });

  it('still says it was embedded when even the referrer is withheld', async () => {
    stubWindow({ framed: true, referrer: '' });
    const pending = createHostVisit({ hubspotTracking: false, formTitle: FORM_TITLE }).resolve();
    await vi.advanceTimersByTimeAsync(SILENT_WAIT_MS);
    expect((await pending)?.visit).toEqual({ embedded: true });
  });

  it('never reads its own cookie inside a frame, whatever the form tracks', async () => {
    stubWindow({ framed: true, cookie: `hubspotutk=${HUTK}` });
    const pending = createHostVisit({ hubspotTracking: true, formTitle: FORM_TITLE }).resolve();
    await vi.advanceTimersByTimeAsync(SILENT_WAIT_MS);
    expect((await pending)?.visit).not.toHaveProperty('hutk');
  });

  it('stops asking once the renderer is gone', () => {
    const w = stubWindow({ framed: true });
    const stop = createHostVisit({ hubspotTracking: false, formTitle: FORM_TITLE }).start();
    stop();
    vi.advanceTimersByTime(MOUNT_RETRY_MS[1] + 1);
    expect(w.posted).toHaveLength(1);
    expect(w.listeners).toHaveLength(0);
  });
});

describe('createHostVisit: a direct link', () => {
  const HREF = 'https://forms.example.com/acme/f/quote?email=lead%40example.com&utm_source=newsletter&step=2';

  it('names the form page itself, keeping only its utm_* (the rest is prefill, i.e. answers)', async () => {
    const w = stubWindow({ framed: false, href: HREF });
    const visit = createHostVisit({ hubspotTracking: false, formTitle: FORM_TITLE });
    visit.start();
    expect(w.posted).toHaveLength(0);
    await expect(visit.resolve()).resolves.toEqual({
      visit: {
        pageUri: 'https://forms.example.com/acme/f/quote?utm_source=newsletter',
        pageName: FORM_TITLE,
        embedded: false,
      },
      hostUtm: {},
    });
  });

  it('sends its own HubSpot cookie only when the FORM loads its tracking code', async () => {
    stubWindow({ framed: false, href: HREF, cookie: `a=1; hubspotutk=${HUTK}; b=2` });
    expect((await createHostVisit({ hubspotTracking: true, formTitle: FORM_TITLE }).resolve())?.visit.hutk).toBe(HUTK);
    expect(await createHostVisit({ hubspotTracking: false, formTitle: FORM_TITLE }).resolve()).not.toHaveProperty(
      'visit.hutk',
    );
  });

  it('respects the visitor opting out of HubSpot tracking', async () => {
    for (const optOut of ['__hs_opt_out=yes', '__hs_do_not_track=yes']) {
      stubWindow({ framed: false, href: HREF, cookie: `hubspotutk=${HUTK}; ${optOut}` });
      const resolved = await createHostVisit({ hubspotTracking: true, formTitle: FORM_TITLE }).resolve();
      expect(resolved?.visit, optOut).not.toHaveProperty('hutk');
    }
  });
});

describe('hostUtm', () => {
  it('reads the utm_* parameters of the landing URL and nothing else', () => {
    expect(hostUtm(`${LANDING}&UTM_Term=x`)).toEqual({
      utm_source: 'facebook',
      utm_medium: 'paid_social',
      UTM_Term: 'x',
    });
  });

  it('is empty without a page, without a campaign, or for something that is not a URL', () => {
    expect(hostUtm(undefined)).toEqual({});
    expect(hostUtm('https://landing.example.com/?q=1')).toEqual({});
    expect(hostUtm('not a url')).toEqual({});
  });

  it('drops empty values and control characters Postgres cannot store', () => {
    expect(hostUtm('https://landing.example.com/?utm_source=&utm_medium=a%00b')).toEqual({ utm_medium: 'ab' });
  });
});
