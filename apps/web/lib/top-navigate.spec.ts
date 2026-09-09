import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isEmbedded,
  navigateTop,
  EMBED_REDIRECT_MESSAGE,
  EMBED_REDIRECT_ACK,
  EMBED_ACK_TIMEOUT_MS,
} from './top-navigate';

type Posted = { message: unknown; targetOrigin: string };

/**
 * A fake window. `framed` decides whether `top` is a different object from
 * `self`, which is the only thing `isEmbedded` looks at. `onTopNav` stands in
 * for a sandbox refusing the frame access to its top.
 */
function stubWindow(opts: { framed: boolean; onPost?: () => void; onTopNav?: () => void }) {
  const posted: Posted[] = [];
  const listeners: Array<(e: MessageEvent) => void> = [];
  const self: Record<string, unknown> = {};
  const location = { href: '' };
  const topLocation = { href: '' };

  const top = opts.framed
    ? {
        get location() {
          if (opts.onTopNav) opts.onTopNav();
          return topLocation;
        },
      }
    : self;

  const parent = {
    postMessage: (message: unknown, targetOrigin: string) => {
      if (opts.onPost) opts.onPost();
      posted.push({ message, targetOrigin });
    },
  };

  Object.assign(self, {
    self,
    top,
    parent,
    location,
    addEventListener: (type: string, fn: (e: MessageEvent) => void) => {
      if (type === 'message') listeners.push(fn);
    },
    removeEventListener: (type: string, fn: (e: MessageEvent) => void) => {
      if (type !== 'message') return;
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    },
  });

  vi.stubGlobal('window', self);

  /** Deliver a message to whatever `navigateTop` is listening with. */
  const deliver = (data: unknown, source: unknown = parent) => {
    for (const fn of [...listeners]) fn({ data, source } as unknown as MessageEvent);
  };

  return { posted, location, topLocation, deliver, listeners };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('isEmbedded', () => {
  it('is false at the top level and true inside a frame', () => {
    stubWindow({ framed: false });
    expect(isEmbedded()).toBe(false);

    stubWindow({ framed: true });
    expect(isEmbedded()).toBe(true);
  });

  it('treats a window whose `top` cannot be read as framed', () => {
    const self: Record<string, unknown> = {};
    self.self = self;
    // Defined, not assigned: `Object.assign` would invoke the getter while
    // copying and throw during setup instead of inside `isEmbedded`.
    Object.defineProperty(self, 'top', {
      get() {
        throw new Error('cross-origin');
      },
    });
    vi.stubGlobal('window', self);
    expect(isEmbedded()).toBe(true);
  });
});

describe('navigateTop, not embedded', () => {
  it('navigates the page exactly as a plain assignment did, and posts nothing', () => {
    const w = stubWindow({ framed: false });
    navigateTop('https://buy.stripe.com/abc');
    expect(w.location.href).toBe('https://buy.stripe.com/abc');
    expect(w.posted).toEqual([]);
    expect(w.listeners).toHaveLength(0); // nothing left listening
  });
});

describe('navigateTop, embedded', () => {
  it('asks the host page first and carries only the URL across', () => {
    const w = stubWindow({ framed: true });
    navigateTop('https://buy.stripe.com/abc');
    expect(w.posted).toEqual([
      {
        message: { type: EMBED_REDIRECT_MESSAGE, url: 'https://buy.stripe.com/abc' },
        targetOrigin: '*',
      },
    ]);
    // Nothing has moved yet — the host is still being given its chance.
    expect(w.topLocation.href).toBe('');
    expect(w.location.href).toBe('');
  });

  it('stands down when the host acknowledges, so the two never race', () => {
    const w = stubWindow({ framed: true });
    navigateTop('https://buy.stripe.com/abc');
    w.deliver({ type: EMBED_REDIRECT_ACK });
    vi.advanceTimersByTime(EMBED_ACK_TIMEOUT_MS * 4);
    expect(w.topLocation.href).toBe(''); // the host page is handling it
    expect(w.location.href).toBe('');
    expect(w.listeners).toHaveLength(0);
  });

  it('navigates the top itself when no acknowledgement arrives', () => {
    const w = stubWindow({ framed: true });
    navigateTop('https://buy.stripe.com/abc');
    vi.advanceTimersByTime(EMBED_ACK_TIMEOUT_MS);
    expect(w.topLocation.href).toBe('https://buy.stripe.com/abc');
    // The frame itself is never navigated: that is the bug being fixed.
    expect(w.location.href).toBe('');
    expect(w.listeners).toHaveLength(0);
  });

  it('ignores an acknowledgement that did not come from the parent', () => {
    const w = stubWindow({ framed: true });
    navigateTop('https://buy.stripe.com/abc');
    w.deliver({ type: EMBED_REDIRECT_ACK }, { some: 'other frame' });
    vi.advanceTimersByTime(EMBED_ACK_TIMEOUT_MS);
    expect(w.topLocation.href).toBe('https://buy.stripe.com/abc');
  });

  it('ignores unrelated messages from the parent', () => {
    const w = stubWindow({ framed: true });
    navigateTop('https://buy.stripe.com/abc');
    w.deliver({ type: 'dapta-forms:resize', height: 700 });
    w.deliver(null);
    vi.advanceTimersByTime(EMBED_ACK_TIMEOUT_MS);
    expect(w.topLocation.href).toBe('https://buy.stripe.com/abc');
  });

  it('still navigates the top when the host refuses the message', () => {
    const w = stubWindow({
      framed: true,
      onPost: () => {
        throw new Error('blocked');
      },
    });
    navigateTop('https://buy.stripe.com/abc');
    vi.advanceTimersByTime(EMBED_ACK_TIMEOUT_MS);
    expect(w.topLocation.href).toBe('https://buy.stripe.com/abc');
  });

  it('survives a sandbox that blocks the top navigation outright', () => {
    const w = stubWindow({
      framed: true,
      onTopNav: () => {
        throw new Error('sandboxed: allow-top-navigation not set');
      },
    });
    navigateTop('https://buy.stripe.com/abc');
    expect(w.posted).toHaveLength(1); // the host page was still asked
    expect(() => vi.advanceTimersByTime(EMBED_ACK_TIMEOUT_MS)).not.toThrow();
    expect(w.topLocation.href).toBe('');
  });
});

describe('navigateTop protocol allowlist', () => {
  it('goes nowhere and posts nothing for a non-http(s) URL', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const url of ['javascript:alert(1)', 'data:text/html,<script>', '/relative']) {
      const w = stubWindow({ framed: true });
      navigateTop(url);
      vi.advanceTimersByTime(EMBED_ACK_TIMEOUT_MS);
      expect(w.posted).toEqual([]);
      expect(w.topLocation.href).toBe('');
      expect(w.location.href).toBe('');
    }
  });
});
