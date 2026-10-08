/**
 * Hidden preloading of Calendly inline widgets, so a scheduler the visitor
 * reaches paints at once instead of after Calendly's cold start (measured at
 * ~4-6 s on a fast link: the iframe document, then a serial chain of API calls
 * ending in the availability lookup; slower on phones).
 *
 * The slides renderer boots each widget hidden once the visitor starts
 * answering; the `BookingScreen` that later shows that booking ADOPTS the live
 * widget instead of starting a new one. Browser facts that shape everything:
 *
 * - **An iframe cannot be moved.** Re-parenting it reloads the document, which
 *   is the cold start all over again. So the widget's host lives on `<body>` for
 *   its whole life and is POSITIONED over the screen's slot when shown. Being
 *   outside the form, it is clipped under the form's sticky banner by hand.
 * - **Hidden must still count as visible.** Browsers stop rendering
 *   cross-origin iframes that are off-screen or `visibility: hidden`; Calendly
 *   then does its work only once shown (measured: ~3.4 s left instead of ~0).
 *   The host therefore sits inside the viewport at `opacity: 0`, behind the
 *   page (`z-index: -1`), `inert` and `aria-hidden`, so it renders but can be
 *   neither seen, clicked, focused nor read.
 *
 * A screen reached before its widget's turn CLAIMS it: it boots right then, in
 * place. Any screen showing a Calendly widget (adopted or cold) also stops the
 * queue and drops widgets still loading, which would only compete with it.
 *
 * The answers do not exist when a widget boots, so the URL carries none; the
 * prefill is posted to the widget once it is shown and rendered
 * (`calendly.prefill`, the message Calendly's own script sends for its
 * `prefill` option).
 *
 * Every function is a no-op on the server.
 */
import { useEffect } from 'react';
import { loadCalendlyScript } from './booking-embed';
import { buildCalendlyEmbedUrl } from './booking-prefill';
import { FOCUSABLE_SELECTOR } from './focusable';

export const CALENDLY_ORIGIN = 'https://calendly.com';

/** Slot height before Calendly reports its own (matches the cold embed's). */
export const CALENDLY_FALLBACK_HEIGHT = 640;

/** Width a hidden widget lays out at: close to the slot it will fill. */
const HIDDEN_MAX_WIDTH = 480;
const HIDDEN_HEIGHT = 700;

/** Start the next widget once the previous one rendered, or after this long. */
const NEXT_WIDGET_AFTER_MS = 6000;

/** How long to track the slot every frame after a layout change (covers the screen's entry animation). */
const FOLLOW_BURST_MS = 700;

/** The screen's own entry fade (`pfSlideIn`), so the widget arrives with it. */
const FADE_MS = 340;

/** Messages that say the widget's app has rendered. */
const RENDERED_EVENTS = new Set(['calendly.page_height', 'calendly.event_type_viewed']);

/** Interactions that mean a person is answering (the queue waits for one). */
const START_EVENTS = ['pointerdown', 'keydown', 'touchstart'] as const;

/** The form's sticky chrome the shown widget must stay under. */
const STICKY_SELECTOR = '.pf__banner, .pf-v__sticky';

interface Shown {
  slot: HTMLElement;
  options: ShowPreloadedOptions;
  /** The form's sticky chrome above the slot (clip and scroll stay under it). */
  stickies: HTMLElement[];
}

interface PreloadedCalendly {
  key: string;
  sessionId: string;
  host: HTMLDivElement;
  iframe: HTMLIFrameElement;
  /** Focus guards around the iframe, live only while shown. */
  guards: [HTMLElement, HTMLElement];
  /** Content height Calendly last reported, in px. */
  height: number | null;
  rendered: boolean;
  shown: Shown | null;
  /** Resolvers waiting for the first render. */
  waiters: Array<() => void>;
}

/** What a screen hands the widget it shows. */
export interface ShowPreloadedOptions {
  /** Calendly's content height, so the slot can reserve that space in the flow. */
  onHeight: (height: number) => void;
  /** The widget is on screen and its app has rendered. */
  onShown: () => void;
  /** Not adoptable after all (another screen holds it): show the cold embed. */
  onUnavailable: () => void;
  /** The widget could not boot (Calendly's script did not load). */
  onFail: () => void;
  /** The visitor's prefill (`calendlyPrefillMessagePayload`), posted on show. */
  prefill: Record<string, string> | null;
}

const registry = new Map<string, PreloadedCalendly>();
/** Keys an active preload owns (booted or still queued), with their session. */
const claimable = new Map<string, string>();
/** Screens currently showing a Calendly widget, adopted or cold. */
let holds = 0;
/** Queues paused by a hold, re-armed when the last hold lets go. */
const resumers = new Set<() => void>();
let listening = false;
let hostSeq = 0;

/** Parse Calendly's `"1234px"` / number height; null when unusable. */
export function parseCalendlyHeight(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? parseFloat(value) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.ceil(n) : null;
}

/** Only Calendly's own scheduling pages are preloaded (and spoken to). */
export function isPreloadableCalendlyUrl(url: string): boolean {
  try {
    return new URL(url).origin === CALENDLY_ORIGIN;
  } catch {
    return false;
  }
}

function hide(entry: PreloadedCalendly): void {
  const { host, iframe, guards } = entry;
  host.inert = true;
  host.setAttribute('aria-hidden', 'true');
  // `inert` is the guard; these cover a browser without it.
  iframe.tabIndex = -1;
  for (const guard of guards) guard.tabIndex = -1;
  const width = Math.min(window.innerWidth, HIDDEN_MAX_WIDTH);
  host.style.cssText =
    `position:fixed;left:0;top:0;width:${width}px;height:${HIDDEN_HEIGHT}px;` +
    'opacity:0;pointer-events:none;z-index:-1;overflow:hidden;';
}

function show(entry: PreloadedCalendly, shown: Shown): void {
  const { host, iframe, guards } = entry;
  host.inert = false;
  host.removeAttribute('aria-hidden');
  iframe.tabIndex = 0;
  for (const guard of guards) guard.tabIndex = 0;
  host.style.cssText =
    'position:absolute;left:0;top:0;opacity:0;z-index:1;overflow:hidden;pointer-events:auto;';
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (reduced) {
    host.style.opacity = '1';
    return;
  }
  window.requestAnimationFrame(() => {
    if (entry.shown !== shown) return; // released before this frame: stay hidden
    host.style.transition = `opacity ${FADE_MS}ms ease-out`;
    host.style.opacity = '1';
  });
}

function entryForSource(source: MessageEventSource | null): PreloadedCalendly | undefined {
  for (const entry of registry.values()) {
    if (entry.iframe.contentWindow === source) return entry;
  }
  return undefined;
}

/**
 * Post the prefill to a shown widget whose app has rendered. Sent twice, as
 * Calendly's script does, in case its listener is still being wired.
 */
function postPrefill(entry: PreloadedCalendly, shown: Shown): void {
  const payload = shown.options.prefill;
  if (!payload) return;
  const post = () => {
    if (entry.shown !== shown) return; // released, or shown again elsewhere
    entry.iframe.contentWindow?.postMessage(
      { event: 'calendly.prefill', payload },
      CALENDLY_ORIGIN,
    );
  };
  post();
  window.setTimeout(post, 250);
}

/**
 * One window listener for every preloaded widget, routed by `event.source`.
 * Calendly's own resize handling is NOT used: it resizes its parent from ANY
 * Calendly frame's message, so with several widgets on a page the hidden ones
 * would resize the visible one.
 */
function onMessage(event: MessageEvent): void {
  if (event.origin !== CALENDLY_ORIGIN) return;
  const entry = entryForSource(event.source);
  if (!entry) return;
  const data = event.data as { event?: unknown; payload?: { height?: unknown } } | null;
  if (!data || typeof data.event !== 'string') return;
  if (RENDERED_EVENTS.has(data.event) && !entry.rendered) {
    entry.rendered = true;
    for (const resolve of entry.waiters.splice(0)) resolve();
    if (entry.shown) {
      entry.shown.options.onShown();
      postPrefill(entry, entry.shown);
    }
  }
  if (data.event !== 'calendly.page_height') return;
  const height = parseCalendlyHeight(data.payload?.height);
  if (height === null) return;
  entry.height = height;
  if (!entry.shown) return;
  entry.host.style.height = `${height}px`;
  entry.shown.options.onHeight(height);
  // Calendly's inline embed brings itself back into view when its content
  // changes while it is scrolled above the fold (picking a day on mobile).
  // Back into view means just under the form's sticky banner, not under it.
  const top = entry.shown.slot.getBoundingClientRect().top;
  const below = stickyBottom(entry.shown.stickies);
  if (top < below) window.scrollBy(0, top - below);
}

/** Where the form's sticky chrome ends, in viewport px (0 when there is none). */
function stickyBottom(stickies: HTMLElement[]): number {
  let bottom = 0;
  for (const el of stickies) {
    const r = el.getBoundingClientRect();
    if (r.height > 0) bottom = Math.max(bottom, r.bottom);
  }
  return bottom;
}

function ensureListener(): void {
  if (listening) return;
  window.addEventListener('message', onMessage);
  listening = true;
}

function destroy(key: string): void {
  const entry = registry.get(key);
  if (!entry || entry.shown) return;
  registry.delete(key);
  for (const resolve of entry.waiters.splice(0)) resolve();
  entry.host.remove();
}

/** Drop a widget nobody preloads any more (its preload was torn down). */
function destroyIfOrphaned(entry: PreloadedCalendly): void {
  if (claimable.get(entry.key) !== entry.sessionId) destroy(entry.key);
}

function focusGuard(onFocus: (from: EventTarget | null) => void): HTMLElement {
  const guard = document.createElement('span');
  guard.style.cssText =
    'position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);';
  guard.addEventListener('focus', (event) => onFocus(event.relatedTarget));
  return guard;
}

/** Focusable controls, plus iframes (another widget's calendar). */
const FOCUSABLE = `${FOCUSABLE_SELECTOR}, iframe`;

/** Move focus to the nearest focusable element before or after `anchor`, outside `skip`. */
function focusBeside(anchor: Element, direction: 'before' | 'after', skip: Element[]): void {
  const all = Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    // Hidden widgets are `aria-hidden` too, which still holds where `inert`
    // is unsupported (the property then never reflects to the attribute).
    (el) => !skip.some((s) => s.contains(el)) && !el.closest('[inert], [aria-hidden="true"]'),
  );
  const following = Node.DOCUMENT_POSITION_FOLLOWING;
  const target =
    direction === 'after'
      ? all.find((el) => anchor.compareDocumentPosition(el) & following)
      : all
          .reverse()
          .find((el) => !(anchor.compareDocumentPosition(el) & following) && el !== anchor);
  if (target) target.focus();
  else (document.activeElement as HTMLElement | null)?.blur();
}

function bootWidget(key: string, sessionId: string): PreloadedCalendly | null {
  if (!window.Calendly) return null;
  const host = document.createElement('div');
  host.id = `pf-calendly-preload-${++hostSeq}`;
  host.setAttribute('data-calendly-preload', '');
  document.body.appendChild(host);
  window.Calendly.initInlineWidget({
    // The same URL a cold BookingScreen builds, with no answers to prefill.
    url: buildCalendlyEmbedUrl(key, {}, { sessionId, embedDomain: window.location.host }),
    parentElement: host,
    resize: false,
  });
  const iframe = host.querySelector('iframe');
  if (!iframe) {
    host.remove();
    return null;
  }
  // Keyboard order: the widget lives at the end of <body>, so these guards
  // return focus to the form around the slot instead of the page's tail.
  const entry: PreloadedCalendly = {
    key,
    sessionId,
    host,
    iframe,
    guards: [
      focusGuard((from) => {
        const slot = entry.shown?.slot;
        if (!slot) return;
        const origin = from instanceof Node ? from : null;
        // Shift+Tab out of the calendar → the form before the slot.
        if (origin && host.contains(origin)) focusBeside(slot, 'before', [host, slot]);
        // Tabbing on past the form's end: the calendar was already visited
        // through the slot, so let focus leave instead of looping back into it.
        else if (origin && slot.compareDocumentPosition(origin) & Node.DOCUMENT_POSITION_FOLLOWING)
          (document.activeElement as HTMLElement | null)?.blur();
        else iframe.focus();
      }),
      focusGuard(() => {
        const slot = entry.shown?.slot;
        if (slot) focusBeside(slot, 'after', [host, slot]); // Tab out → the form after the slot.
      }),
    ],
    height: null,
    rendered: false,
    shown: null,
    waiters: [],
  };
  host.insertBefore(entry.guards[0], host.firstChild);
  host.appendChild(entry.guards[1]);
  hide(entry);
  registry.set(key, entry);
  return entry;
}

/** Boot `key` now unless the queue already did (script first, if needed). */
async function bootNow(key: string, sessionId: string): Promise<PreloadedCalendly | null> {
  try {
    await loadCalendlyScript();
  } catch {
    return null;
  }
  ensureListener();
  const existing = registry.get(key);
  if (existing) return existing.sessionId === sessionId ? existing : null;
  return bootWidget(key, sessionId);
}

function waitRendered(entry: PreloadedCalendly): Promise<void> {
  if (entry.rendered) return Promise.resolve();
  return new Promise((resolve) => {
    entry.waiters.push(resolve);
    window.setTimeout(resolve, NEXT_WIDGET_AFTER_MS);
  });
}

/**
 * A screen is about to show a Calendly widget: stop the queue and drop the
 * widgets still loading in the background (they would only compete with this
 * one for the network and the CPU, and a later screen re-boots its own).
 * Returns the release.
 */
export function holdCalendlyPreload(exceptKey?: string): () => void {
  if (typeof window === 'undefined') return () => undefined;
  holds += 1;
  for (const entry of [...registry.values()]) {
    if (entry.key !== exceptKey && !entry.rendered) destroy(entry.key);
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds -= 1;
    if (holds === 0) for (const resume of [...resumers]) resume();
  };
}

/**
 * Boot the given bookings' widgets hidden, ONE AT A TIME (each is a full app;
 * three at once makes a cheap phone stutter through the quiz), starting at the
 * visitor's first interaction, so a bounce never loads Calendly. Only Calendly's
 * own pages; skipped when the visitor asked to save data. Returns a cleanup that
 * stops the queue and removes every widget it booted that is not on screen (a
 * shown one goes when its screen lets it go).
 */
export function preloadCalendlyEmbeds(keys: string[], sessionId: string): () => void {
  if (typeof window === 'undefined' || !sessionId) return () => undefined;
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (connection?.saveData) return () => undefined;
  const owned = keys.filter(isPreloadableCalendlyUrl);
  if (owned.length === 0) return () => undefined;

  let cancelled = false;
  let running = false;
  let paused = false;
  for (const key of owned) claimable.set(key, sessionId);

  const run = async () => {
    running = true;
    try {
      await loadCalendlyScript();
      ensureListener();
      for (const key of owned) {
        if (cancelled) return;
        // While a screen shows a booking the rest of the queue only competes
        // with it; pick up again once it lets go (Back, Skip, a tier change).
        if (holds > 0) {
          paused = true;
          return;
        }
        if (registry.has(key)) continue;
        const entry = bootWidget(key, sessionId);
        if (!entry) return;
        await waitRendered(entry);
      }
    } catch {
      // Calendly's script did not load: a screen that needs it shows its own
      // fallback link.
    } finally {
      running = false;
    }
  };
  const disarm = () => {
    for (const type of START_EVENTS) window.removeEventListener(type, start, true);
  };
  const start = () => {
    if (cancelled || running) return;
    disarm();
    void run();
  };
  // (Re)start at the visitor's next interaction: the first one, or the first
  // after a pause, so a visitor who booked and left the screen alone (the done
  // screen, a redirect) never boots the rest.
  const arm = () => {
    for (const type of START_EVENTS) {
      window.addEventListener(type, start, { capture: true, passive: true });
    }
  };
  const resume = () => {
    if (!paused || cancelled) return;
    paused = false;
    arm();
  };
  resumers.add(resume);
  arm();

  return () => {
    cancelled = true;
    resumers.delete(resume);
    disarm();
    for (const key of owned) {
      if (claimable.get(key) === sessionId) claimable.delete(key);
      destroy(key);
    }
  };
}

/** React wrapper: (re)preloads when the set of keys or the session changes. */
export function useCalendlyPreload(keys: string[], sessionId: string): void {
  const signature = keys.join('\n');
  useEffect(() => {
    if (!signature) return;
    return preloadCalendlyEmbeds(signature.split('\n'), sessionId);
  }, [signature, sessionId]);
}

/**
 * Whether this booking's widget belongs to an active preload for this session
 * (booted, or still queued: showing it boots it on the spot) and is free.
 */
export function hasPreloadedCalendly(key: string, sessionId: string): boolean {
  if (claimable.get(key) !== sessionId) return false;
  const entry = registry.get(key);
  return !entry || (entry.sessionId === sessionId && !entry.shown);
}

/**
 * Show the preloaded widget over `slot` (a widget still queued boots now) and
 * keep it there: position and width follow the slot through layout changes and
 * the screen's entry animation, and the top is clipped under the form's sticky
 * banner. The prefill is posted once the app has rendered. Returns the release,
 * which hides the widget again (it stays alive for a return to the screen) or
 * removes it when its preload is gone.
 */
export function showPreloadedCalendly(
  key: string,
  sessionId: string,
  slot: HTMLElement,
  options: ShowPreloadedOptions,
): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const unhold = holdCalendlyPreload(key);
  let released = false;
  let detach: (() => void) | null = null;
  let attached: PreloadedCalendly | null = null;

  const adopt = (entry: PreloadedCalendly) => {
    detach = attach(entry, sessionId, slot, options);
    if (detach) attached = entry;
    else options.onUnavailable();
  };
  const existing = registry.get(key);
  if (existing && !existing.host.isConnected) registry.delete(key);
  const live = registry.get(key);
  if (live) {
    adopt(live);
  } else {
    void bootNow(key, sessionId).then((entry) => {
      if (released) {
        if (entry) destroyIfOrphaned(entry);
        return;
      }
      if (entry) adopt(entry);
      else options.onFail();
    });
  }

  return () => {
    if (released) return;
    released = true;
    unhold();
    detach?.();
    if (attached) destroyIfOrphaned(attached);
  };
}

function attach(
  entry: PreloadedCalendly,
  sessionId: string,
  slot: HTMLElement,
  options: ShowPreloadedOptions,
): (() => void) | null {
  // Held by another screen, or booted for another session: its URL carries
  // that session's id, which Calendly hands back as the booking's attribution.
  if (entry.shown || entry.sessionId !== sessionId) return null;
  const sentinel = focusGuard(() => entry.iframe.focus());
  sentinel.tabIndex = 0;
  slot.appendChild(sentinel);
  slot.setAttribute('aria-owns', entry.host.id);
  const stickies = Array.from(
    slot.closest('.pf')?.querySelectorAll<HTMLElement>(STICKY_SELECTOR) ?? [],
  );
  const shown: Shown = { slot, options, stickies };
  entry.shown = shown;
  const { host } = entry;
  show(entry, shown);
  const height = entry.height ?? CALENDLY_FALLBACK_HEIGHT;
  host.style.height = `${height}px`;
  options.onHeight(height);
  if (entry.rendered) {
    options.onShown();
    postPrefill(entry, shown);
  }

  const clip = (top: number) => {
    const covered = stickyBottom(stickies) - top;
    host.style.clipPath = covered > 0 ? `inset(${Math.ceil(covered)}px 0 0 0)` : '';
  };
  let last = '';
  // Position in document coordinates (the host is on <body>), so scrolling never
  // moves it; only the sticky clip depends on scroll.
  const place = () => {
    const rect = slot.getBoundingClientRect();
    const next = `${rect.left + window.scrollX}|${rect.top + window.scrollY}|${rect.width}`;
    if (next !== last) {
      last = next;
      host.style.left = `${rect.left + window.scrollX}px`;
      host.style.top = `${rect.top + window.scrollY}px`;
      host.style.width = `${rect.width}px`;
    }
    clip(rect.top);
  };

  let frame = 0;
  let burstUntil = 0;
  const tick = () => {
    place();
    frame = performance.now() < burstUntil ? window.requestAnimationFrame(tick) : 0;
  };
  const burst = () => {
    burstUntil = performance.now() + FOLLOW_BURST_MS;
    if (!frame) frame = window.requestAnimationFrame(tick);
  };
  const onScroll = () => clip(slot.getBoundingClientRect().top);
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(burst);
  observer?.observe(slot);
  observer?.observe(document.body);
  window.addEventListener('resize', burst);
  window.addEventListener('scroll', onScroll, { passive: true });
  place();
  burst();

  return () => {
    window.cancelAnimationFrame(frame);
    observer?.disconnect();
    window.removeEventListener('resize', burst);
    window.removeEventListener('scroll', onScroll);
    sentinel.remove();
    slot.removeAttribute('aria-owns');
    entry.shown = null;
    hide(entry);
  };
}
