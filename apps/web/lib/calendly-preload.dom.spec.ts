// @vitest-environment happy-dom
/**
 * The stateful side of the hidden Calendly preloader, against a fake
 * `Calendly.initInlineWidget` that mounts an empty iframe: the queue, claims,
 * holds, adoption, release, and teardown. Each test gets a fresh module so
 * the page-global registry never leaks between them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const P1 = 'https://calendly.com/d/aaaa/p1';
const P2 = 'https://calendly.com/d/bbbb/p2';
const P3 = 'https://calendly.com/d/cccc/p3';

type Preload = typeof import('./calendly-preload');

let scriptFails = false;
vi.mock('./booking-embed', () => ({
  loadCalendlyScript: () =>
    scriptFails ? Promise.reject(new Error('blocked')) : Promise.resolve(),
}));

async function freshModule(): Promise<Preload> {
  vi.resetModules();
  return import('./calendly-preload');
}

const hosts = () =>
  Array.from(document.querySelectorAll<HTMLDivElement>('[data-calendly-preload]'));
const shownHosts = () => hosts().filter((h) => h.getAttribute('aria-hidden') !== 'true');
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};
const interact = () => window.dispatchEvent(new Event('pointerdown'));
/** Calendly saying its app rendered, from the widget's own frame. */
function rendered(host: HTMLDivElement): void {
  const frame = host.querySelector('iframe')!;
  window.dispatchEvent(
    new MessageEvent('message', {
      origin: 'https://calendly.com',
      source: frame.contentWindow,
      data: { event: 'calendly.page_height', payload: { height: '900px' } },
    }),
  );
}
function options(overrides: Partial<Parameters<Preload['showPreloadedCalendly']>[3]> = {}) {
  return {
    onHeight: vi.fn(),
    onShown: vi.fn(),
    onUnavailable: vi.fn(),
    onFail: vi.fn(),
    prefill: null,
    ...overrides,
  };
}
const stops: Array<() => void> = [];
function track(stop: () => void): () => void {
  stops.push(stop);
  return stop;
}
function slot(): HTMLDivElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  scriptFails = false;
  document.body.innerHTML = '';
  (window as unknown as { Calendly: unknown }).Calendly = {
    initInlineWidget: ({ parentElement }: { parentElement: HTMLElement }) => {
      parentElement.appendChild(document.createElement('iframe'));
    },
  };
});
afterEach(() => {
  // Each test's queues stop listening, so none starts on a later test's input.
  for (const stop of stops.splice(0)) stop();
  document.body.innerHTML = '';
});

describe('the preload queue', () => {
  it('waits for the visitor to interact, then boots one widget at a time', async () => {
    const m = await freshModule();
    track(m.preloadCalendlyEmbeds([P1, P2, P3], 's1'));
    await flush();
    expect(hosts()).toHaveLength(0); // a bounce loads nothing

    interact();
    await flush();
    expect(hosts()).toHaveLength(1);
    rendered(hosts()[0]!);
    await flush();
    expect(hosts()).toHaveLength(2);
  });

  it('boots hidden: in the viewport, transparent, behind the page, inert', async () => {
    const m = await freshModule();
    track(m.preloadCalendlyEmbeds([P1], 's1'));
    interact();
    await flush();
    const host = hosts()[0]!;
    expect(host.style.position).toBe('fixed');
    expect(host.style.opacity).toBe('0');
    expect(host.style.zIndex).toBe('-1');
    expect(host.inert).toBe(true);
    expect(host.getAttribute('aria-hidden')).toBe('true');
    expect(host.querySelector('iframe')!.tabIndex).toBe(-1);
  });

  it('only preloads calendly.com pages', async () => {
    const m = await freshModule();
    track(m.preloadCalendlyEmbeds(['https://book.acme.com/intro'], 's1'));
    interact();
    await flush();
    expect(hosts()).toHaveLength(0);
    expect(m.hasPreloadedCalendly('https://book.acme.com/intro', 's1')).toBe(false);
  });

  it('skips everything when the visitor asked to save data', async () => {
    Object.defineProperty(navigator, 'connection', {
      value: { saveData: true },
      configurable: true,
    });
    const m = await freshModule();
    track(m.preloadCalendlyEmbeds([P1], 's1'));
    interact();
    await flush();
    expect(hosts()).toHaveLength(0);
    expect(m.hasPreloadedCalendly(P1, 's1')).toBe(false);
    Object.defineProperty(navigator, 'connection', { value: undefined, configurable: true });
  });

  it('stops, and drops widgets still loading, once a screen holds a widget', async () => {
    const m = await freshModule();
    track(m.preloadCalendlyEmbeds([P1, P2], 's1'));
    interact();
    await flush();
    expect(hosts()).toHaveLength(1); // P1 loading
    const release = m.holdCalendlyPreload();
    expect(hosts()).toHaveLength(0); // P1 dropped: it would compete with the held one
    await flush();
    expect(hosts()).toHaveLength(0); // and the queue does not go on to P2
    release();
  });
});

describe('adopting a widget', () => {
  it('shows a booted widget over the slot and reports it rendered', async () => {
    const m = await freshModule();
    track(m.preloadCalendlyEmbeds([P1], 's1'));
    interact();
    await flush();
    rendered(hosts()[0]!);
    expect(m.hasPreloadedCalendly(P1, 's1')).toBe(true);

    const target = slot();
    const opts = options();
    const release = m.showPreloadedCalendly(P1, 's1', target, opts);
    const host = hosts()[0]!;
    expect(shownHosts()).toEqual([host]);
    expect(host.style.position).toBe('absolute');
    expect(host.inert).toBe(false);
    expect(target.getAttribute('aria-owns')).toBe(host.id);
    expect(opts.onHeight).toHaveBeenCalledWith(900);
    expect(opts.onShown).toHaveBeenCalled();
    expect(m.hasPreloadedCalendly(P1, 's1')).toBe(false); // taken

    release();
    expect(shownHosts()).toHaveLength(0);
    expect(hosts()).toHaveLength(1); // kept for a return to the screen
    expect(target.hasAttribute('aria-owns')).toBe(false);
  });

  it('boots a widget still queued on the spot instead of a second cold one', async () => {
    const m = await freshModule();
    track(m.preloadCalendlyEmbeds([P1, P2, P3], 's1')); // never interacted: nothing booted
    expect(m.hasPreloadedCalendly(P3, 's1')).toBe(true);
    const opts = options();
    m.showPreloadedCalendly(P3, 's1', slot(), opts);
    await flush();
    expect(hosts()).toHaveLength(1);
    expect(shownHosts()).toHaveLength(1);
    expect(opts.onShown).not.toHaveBeenCalled(); // not rendered yet
    rendered(hosts()[0]!);
    expect(opts.onShown).toHaveBeenCalled();
  });

  it('posts the prefill to the widget once it has rendered', async () => {
    const m = await freshModule();
    track(m.preloadCalendlyEmbeds([P1], 's1'));
    interact();
    await flush();
    const frame = hosts()[0]!.querySelector('iframe')!;
    const post = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => undefined);
    m.showPreloadedCalendly(P1, 's1', slot(), options({ prefill: { email: 'ada@example.com' } }));
    expect(post).not.toHaveBeenCalled(); // the app is not listening yet
    rendered(hosts()[0]!);
    expect(post).toHaveBeenCalledWith(
      { event: 'calendly.prefill', payload: { email: 'ada@example.com' } },
      'https://calendly.com',
    );
  });

  it('is not adoptable by another session', async () => {
    const m = await freshModule();
    track(m.preloadCalendlyEmbeds([P1], 's1'));
    expect(m.hasPreloadedCalendly(P1, 's2')).toBe(false);
  });

  it('sends a screen that finds the widget taken back to the cold embed', async () => {
    const m = await freshModule();
    track(m.preloadCalendlyEmbeds([P1], 's1'));
    interact();
    await flush();
    m.showPreloadedCalendly(P1, 's1', slot(), options());
    const second = options();
    m.showPreloadedCalendly(P1, 's1', slot(), second);
    expect(second.onUnavailable).toHaveBeenCalled();
    expect(second.onFail).not.toHaveBeenCalled();
  });

  it('reports a failure when Calendly cannot load', async () => {
    scriptFails = true;
    const m = await freshModule();
    track(m.preloadCalendlyEmbeds([P1], 's1'));
    const opts = options();
    m.showPreloadedCalendly(P1, 's1', slot(), opts);
    await flush();
    expect(opts.onFail).toHaveBeenCalled();
  });
});

describe('review fixes', () => {
  it('picks the queue back up at the next interaction once the hold lets go', async () => {
    const m = await freshModule();
    track(m.preloadCalendlyEmbeds([P1, P2], 's1'));
    interact();
    await flush();
    rendered(hosts()[0]!); // P1 ready; the queue moves on to P2…
    const release = m.holdCalendlyPreload(); // …but a screen holds first
    await flush();
    expect(hosts()).toHaveLength(1);
    release(); // Back from the booking
    await flush();
    expect(hosts()).toHaveLength(1); // nothing until the visitor acts again
    interact();
    await flush();
    expect(hosts()).toHaveLength(2);
  });

  it('never adopts a widget booted for another session', async () => {
    const m = await freshModule();
    track(m.preloadCalendlyEmbeds([P1], 's1'));
    interact();
    await flush();
    const opts = options();
    m.showPreloadedCalendly(P1, 's2', slot(), opts);
    expect(opts.onUnavailable).toHaveBeenCalled();
    expect(shownHosts()).toHaveLength(0);
  });

  it('stays hidden when released before its fade-in frame', async () => {
    const m = await freshModule();
    track(m.preloadCalendlyEmbeds([P1], 's1'));
    interact();
    await flush();
    const release = m.showPreloadedCalendly(P1, 's1', slot(), options());
    release();
    await new Promise((r) => setTimeout(r, 50));
    expect(hosts()[0]!.style.opacity).toBe('0');
  });

  it('brings the calendar back into view just under the sticky banner', async () => {
    const m = await freshModule();
    track(m.preloadCalendlyEmbeds([P1], 's1'));
    interact();
    await flush();
    const form = document.createElement('div');
    form.className = 'pf';
    const banner = document.createElement('div');
    banner.className = 'pf__banner';
    const target = document.createElement('div');
    form.append(banner, target);
    document.body.appendChild(form);
    banner.getBoundingClientRect = () => ({ top: 0, bottom: 40, height: 40 }) as DOMRect;
    target.getBoundingClientRect = () =>
      ({ top: -100, bottom: 500, height: 600, left: 0, width: 300 }) as DOMRect;
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);
    m.showPreloadedCalendly(P1, 's1', target, options());
    rendered(hosts()[0]!);
    expect(scrollBy).toHaveBeenCalledWith(0, -140);
  });
});

describe('teardown', () => {
  it('removes hidden widgets when the preload is torn down', async () => {
    const m = await freshModule();
    const stop = track(m.preloadCalendlyEmbeds([P1], 's1'));
    interact();
    await flush();
    expect(hosts()).toHaveLength(1);
    stop();
    expect(hosts()).toHaveLength(0);
  });

  it('removes a shown widget when its screen lets go after the preload is gone', async () => {
    // React cleans the renderer (the preload) up before the screen inside it.
    const m = await freshModule();
    const stop = track(m.preloadCalendlyEmbeds([P1], 's1'));
    interact();
    await flush();
    const release = m.showPreloadedCalendly(P1, 's1', slot(), options());
    stop();
    expect(hosts()).toHaveLength(1); // still on screen
    release();
    expect(hosts()).toHaveLength(0);
  });

  it('does not leave behind a widget booted for a screen already gone', async () => {
    const m = await freshModule();
    const stop = track(m.preloadCalendlyEmbeds([P1], 's1'));
    const release = m.showPreloadedCalendly(P1, 's1', slot(), options());
    release();
    stop();
    await flush();
    expect(hosts()).toHaveLength(0);
  });
});
