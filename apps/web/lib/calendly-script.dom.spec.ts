// @vitest-environment happy-dom
/**
 * `loadCalendlyScript` must settle on every path: a blocked script (ad blocker,
 * CSP, offline) rejects, removes its tag, and lets the next caller try afresh
 * instead of waiting forever on events that already fired.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Embed = typeof import('./booking-embed');

async function freshModule(): Promise<Embed> {
  vi.resetModules();
  return import('./booking-embed');
}

/** Script tags the loader inserted (kept out of the DOM, so nothing fetches them). */
let inserted: HTMLScriptElement[] = [];
const latest = () => inserted[inserted.length - 1]!;

beforeEach(() => {
  document.body.innerHTML = '';
  delete (window as { Calendly?: unknown }).Calendly;
  inserted = [];
  // Capture the tag instead of inserting it: the test drives its events.
  const append = document.body.appendChild.bind(document.body);
  vi.spyOn(document.body, 'appendChild').mockImplementation(<T extends Node>(node: T): T => {
    if (node instanceof HTMLScriptElement) {
      inserted.push(node);
      return node;
    }
    return append(node);
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('loadCalendlyScript', () => {
  it('resolves once the script has defined Calendly, sharing one tag', async () => {
    const m = await freshModule();
    const a = m.loadCalendlyScript();
    const b = m.loadCalendlyScript();
    expect(inserted).toHaveLength(1);
    expect(latest().src).toBe(m.CALENDLY_SCRIPT_SRC);
    (window as { Calendly?: unknown }).Calendly = { initInlineWidget: () => undefined };
    latest().dispatchEvent(new Event('load'));
    await expect(a).resolves.toBeUndefined();
    await expect(b).resolves.toBeUndefined();
  });

  it('rejects a blocked script, drops its tag, and retries on the next call', async () => {
    const m = await freshModule();
    const first = m.loadCalendlyScript();
    const dead = latest();
    const removed = vi.spyOn(dead, 'remove');
    dead.dispatchEvent(new Event('error'));
    await expect(first).rejects.toThrow();
    expect(removed).toHaveBeenCalled();

    const second = m.loadCalendlyScript();
    expect(inserted).toHaveLength(2); // a fresh attempt, not a wait on the dead tag
    (window as { Calendly?: unknown }).Calendly = { initInlineWidget: () => undefined };
    latest().dispatchEvent(new Event('load'));
    await expect(second).resolves.toBeUndefined();
  });

  it('gives up on a load that never settles', async () => {
    vi.useFakeTimers();
    const m = await freshModule();
    const pending = m.loadCalendlyScript();
    vi.advanceTimersByTime(m.CALENDLY_SCRIPT_TIMEOUT_MS);
    await expect(pending).rejects.toThrow();
    m.loadCalendlyScript().catch(() => undefined);
    expect(inserted).toHaveLength(2); // forgotten: the next caller tries again
  });

  it('ignores a late error from an attempt that already gave up', async () => {
    vi.useFakeTimers();
    const m = await freshModule();
    const stalled = m.loadCalendlyScript();
    const stalledTag = latest();
    vi.advanceTimersByTime(m.CALENDLY_SCRIPT_TIMEOUT_MS);
    await expect(stalled).rejects.toThrow();
    const current = m.loadCalendlyScript();
    stalledTag.dispatchEvent(new Event('error')); // the old tag finally errors
    expect(m.loadCalendlyScript()).toBe(current); // still the in-flight attempt
    expect(inserted).toHaveLength(2);
    current.catch(() => undefined);
  });

  it('rejects when the script loaded but defined nothing', async () => {
    const m = await freshModule();
    const pending = m.loadCalendlyScript();
    latest().dispatchEvent(new Event('load'));
    await expect(pending).rejects.toThrow();
  });
});
