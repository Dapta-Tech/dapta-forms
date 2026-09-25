// @vitest-environment happy-dom
/**
 * The embed height reporter, on an `?embed=1` render inside a host's iframe.
 *
 * What it pins: the height sent to the host is the FORM's, not the document's.
 * The document can never be shorter than the frame (the body's `min-h-dvh` is
 * the frame's own height), so measuring it let the frame grow and never come
 * back down: a one-page form that swapped to its short ending stayed at the full
 * form's height, the ending off screen at the top of an empty block. And a
 * whole-screen swap asks the host to bring the frame into view, never the
 * screen the page loads with.
 *
 * The test DOM does no layout, so the wrapper's geometry is stubbed and the
 * resize observer and animation frames are driven by hand.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMBED_SCREEN_EVENT, announceScreenChange } from '@/lib/embed-screen';
import { EmbedHeightReporter } from './embed-height-reporter';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let posted: unknown[];
let frames: FrameRequestCallback[];
let observed: Element[];
let resizeCallbacks: (() => void)[];
let root: Root | undefined;
let host: HTMLDivElement | undefined;
let wrapper: HTMLDivElement;
let contentHeight: number;

/** Run every queued animation frame, including ones queued while running. */
function flushFrames() {
  for (let i = 0; i < 10 && frames.length; i++) {
    const run = frames.splice(0);
    for (const f of run) f(0);
  }
}

beforeEach(() => {
  posted = [];
  frames = [];
  observed = [];
  resizeCallbacks = [];
  contentHeight = 1265;

  // Embedded: the parent is another window.
  Object.defineProperty(window, 'parent', {
    configurable: true,
    value: { postMessage: (m: unknown) => posted.push(m) },
  });
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(cb: () => void) {
        resizeCallbacks.push(cb);
      }
      observe(el: Element) {
        observed.push(el);
      }
      disconnect() {}
    },
  );

  // The document is as tall as the frame (the body's min-h-dvh); the form is not.
  Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, get: () => 1265 });
  Object.defineProperty(document.body, 'scrollHeight', { configurable: true, get: () => 1265 });
  wrapper = document.createElement('div');
  wrapper.className = 'pf-embed-root';
  Object.defineProperty(wrapper, 'scrollHeight', { configurable: true, get: () => contentHeight });
  wrapper.getBoundingClientRect = () => ({ top: 0, bottom: contentHeight, height: contentHeight }) as DOMRect;
  document.body.append(wrapper);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  wrapper.remove();
  vi.unstubAllGlobals();
  Object.defineProperty(window, 'parent', { configurable: true, value: window });
});

async function mount() {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<EmbedHeightReporter />));
}

const heights = () =>
  posted
    .filter((m): m is { type: string; height: number } => (m as { type: string }).type === 'dapta-forms:resize')
    .map((m) => m.height);
const scrolls = () => posted.filter((m) => (m as { type: string }).type === 'dapta-forms:scroll-into-view');

describe('EmbedHeightReporter', () => {
  it('watches the form wrapper, not the document that never shrinks', async () => {
    await mount();
    expect(observed).toEqual([wrapper]);
    flushFrames();
    expect(heights()).toEqual([1265]);
  });

  it('reports a SHORTER height when the form swaps to its short ending', async () => {
    await mount();
    flushFrames();
    // The ending renders: the form is 480px, the document is still 1265px.
    contentHeight = 480;
    resizeCallbacks.forEach((cb) => cb());
    flushFrames();
    expect(heights().at(-1)).toBe(480);
  });

  it('asks the host to bring the frame into view after a whole-screen swap, height first', async () => {
    await mount();
    flushFrames();
    posted.length = 0;
    contentHeight = 480;
    act(() => announceScreenChange());
    flushFrames();
    expect(posted).toEqual([
      { type: 'dapta-forms:resize', height: 480 },
      { type: 'dapta-forms:scroll-into-view' },
    ]);
  });

  it('never asks for a scroll on its own: loading a page does not move the host', async () => {
    await mount();
    flushFrames();
    window.dispatchEvent(new Event('load'));
    resizeCallbacks.forEach((cb) => cb());
    flushFrames();
    expect(scrolls()).toEqual([]);
  });

  it('does nothing on a page that is not embedded', async () => {
    Object.defineProperty(window, 'parent', { configurable: true, value: window });
    const spy = vi.spyOn(window, 'postMessage');
    await mount();
    act(() => {
      window.dispatchEvent(new Event(EMBED_SCREEN_EVENT));
    });
    flushFrames();
    expect(observed).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });
});
