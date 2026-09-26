// @vitest-environment happy-dom
/**
 * The challenge script loader. It is the only thing on a public form that
 * talks to the challenge provider before the final submit, so what it pins is
 * WHEN and HOW OFTEN: nothing until asked, one tag however often it is asked,
 * and a failed load that can be tried again instead of poisoning the page.
 *
 * The test DOM never fetches scripts, so tags are captured on their way into
 * `<head>` and their load / error events are fired by hand.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TURNSTILE_SCRIPT_SRC, loadTurnstile, warmTurnstile, resetTurnstileLoaderForTests } from './captcha';

const fakeApi = { render: () => 'w1', reset: () => {}, remove: () => {} };
let inserted: HTMLScriptElement[];
let links: HTMLLinkElement[];

beforeEach(() => {
  resetTurnstileLoaderForTests();
  delete (window as { turnstile?: unknown }).turnstile;
  inserted = [];
  links = [];
  document.head.innerHTML = '';
  vi.spyOn(document.head, 'appendChild').mockImplementation(<T extends Node>(node: T): T => {
    if (node instanceof HTMLScriptElement) inserted.push(node);
    else if (node instanceof HTMLLinkElement) {
      links.push(node);
      // Links are inert here, so let them into the DOM for the dedupe lookup.
      Node.prototype.appendChild.call(document.head, node);
    }
    return node;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (window as { turnstile?: unknown }).turnstile;
});

describe('loadTurnstile', () => {
  it('adds nothing to the page until it is called', () => {
    expect(inserted).toHaveLength(0);
  });

  it('inserts exactly one tag, from the provider’s own URL, however often it is asked', async () => {
    const first = loadTurnstile();
    const second = loadTurnstile();
    expect(inserted.map((s) => s.src)).toEqual([TURNSTILE_SCRIPT_SRC]);
    expect(TURNSTILE_SCRIPT_SRC).toBe('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit');

    (window as { turnstile?: unknown }).turnstile = fakeApi;
    inserted[0]!.dispatchEvent(new Event('load'));
    await expect(first).resolves.toBe(fakeApi);
    await expect(second).resolves.toBe(fakeApi);
    // Loaded: later calls resolve at once and add nothing.
    await expect(loadTurnstile()).resolves.toBe(fakeApi);
    expect(inserted).toHaveLength(1);
  });

  it('rejects when the script fails, drops the dead tag, and a later call tries again', async () => {
    const failed = loadTurnstile();
    const dead = inserted[0]!;
    const removed = vi.spyOn(dead, 'remove');
    dead.dispatchEvent(new Event('error'));
    await expect(failed).rejects.toThrow();
    expect(removed).toHaveBeenCalled();

    const retry = loadTurnstile();
    expect(inserted).toHaveLength(2);
    (window as { turnstile?: unknown }).turnstile = fakeApi;
    inserted[1]!.dispatchEvent(new Event('load'));
    await expect(retry).resolves.toBe(fakeApi);
  });

  it('rejects a script that loads but defines no API (blocked or rewritten on the way)', async () => {
    const empty = loadTurnstile();
    inserted[0]!.dispatchEvent(new Event('load'));
    await expect(empty).rejects.toThrow();
  });
});

describe('warmTurnstile', () => {
  it('opens the connection early and starts loading, once', () => {
    warmTurnstile();
    warmTurnstile();
    expect(links.map((l) => [l.rel, l.href])).toEqual([['preconnect', 'https://challenges.cloudflare.com/']]);
    expect(inserted).toHaveLength(1);
  });
});
