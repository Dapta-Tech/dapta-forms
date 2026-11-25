/**
 * The first-party browser id (lib/browser-id.ts): its shape, minting once and
 * keeping what is there, and the header the API reads.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  BROWSER_ID_COOKIE,
  BROWSER_ID_HEADER,
  browserIdFromCookie,
  browserIdHeaders,
  ensureBrowserId,
  newBrowserId,
} from './browser-id';

const jarOf = (entries: Record<string, string> = {}) => {
  const store = new Map(Object.entries(entries));
  return {
    store,
    get: (name: string) => (store.has(name) ? { value: store.get(name)! } : undefined),
    set: vi.fn((name: string, value: string) => void store.set(name, value)),
  };
};

describe('newBrowserId', () => {
  it('is 32 random bytes as base64url: 43 URL-safe characters, never the same twice', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newBrowserId()));
    expect(ids.size).toBe(50);
    for (const id of ids) {
      expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(browserIdFromCookie(id)).toBe(id);
    }
  });
});

describe('browserIdFromCookie', () => {
  it('reads nothing from a missing, short or junk value', () => {
    expect(browserIdFromCookie(undefined)).toBeNull();
    expect(browserIdFromCookie('')).toBeNull();
    expect(browserIdFromCookie('short')).toBeNull();
    expect(browserIdFromCookie('a'.repeat(30) + ';x')).toBeNull();
    expect(browserIdFromCookie('a'.repeat(129))).toBeNull();
  });
});

describe('ensureBrowserId', () => {
  it('mints one when the browser has none, httpOnly for two years', () => {
    const jar = jarOf();
    const id = ensureBrowserId(jar);
    expect(jar.store.get(BROWSER_ID_COOKIE)).toBe(id);
    expect(jar.set).toHaveBeenCalledWith(
      BROWSER_ID_COOKIE,
      id,
      expect.objectContaining({ path: '/', httpOnly: true, sameSite: 'lax', maxAge: 63_072_000 }),
    );
  });

  it('keeps the one already there', () => {
    const jar = jarOf({ [BROWSER_ID_COOKIE]: 'B'.repeat(43) });
    expect(ensureBrowserId(jar)).toBe('B'.repeat(43));
    expect(jar.set).not.toHaveBeenCalled();
  });
});

describe('browserIdHeaders', () => {
  it('forwards a well-formed id, and nothing otherwise', () => {
    expect(browserIdHeaders(jarOf({ [BROWSER_ID_COOKIE]: 'C'.repeat(43) }))).toEqual({ [BROWSER_ID_HEADER]: 'C'.repeat(43) });
    expect(browserIdHeaders(jarOf())).toEqual({});
    expect(browserIdHeaders(jarOf({ [BROWSER_ID_COOKIE]: 'nope' }))).toEqual({});
  });
});
