// @vitest-environment happy-dom
/**
 * `public/embed.js`, the script a customer pastes next to the iframe, run as
 * the host page runs it. It is plain ES5 with no build step, so the file itself
 * is evaluated here.
 *
 * Pinned: the scroll request brings the frame's top into view ONLY when that
 * top is off screen, smoothly unless reduced motion is asked for, and only for
 * a frame of ours; and the existing resize handler is untouched.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SCRIPT = readFileSync(path.resolve(__dirname, '../public/embed.js'), 'utf8');
// The script registers a window listener; evaluate it once for the file.
new Function(SCRIPT)();

let frame: HTMLIFrameElement;
let scrolled: unknown[];
let top: number;
let reduced: boolean;

beforeEach(() => {
  scrolled = [];
  top = -900; // scrolled past the frame's top, as after a long one-page form
  reduced = false;
  frame = document.createElement('iframe');
  frame.setAttribute('data-dapta-forms', '');
  document.body.append(frame);
  frame.getBoundingClientRect = () => ({ top, bottom: top + 480, height: 480 }) as DOMRect;
  frame.scrollIntoView = ((arg?: unknown) => scrolled.push(arg)) as typeof frame.scrollIntoView;
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce') ? reduced : false }));
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 });
});

afterEach(() => {
  frame.remove();
  vi.unstubAllGlobals();
});

function send(data: unknown, source: unknown = frame.contentWindow) {
  window.dispatchEvent(new MessageEvent('message', { data, source: source as Window }));
}

describe('embed.js: dapta-forms:scroll-into-view', () => {
  it('scrolls the frame into view, smoothly, when its top is above the viewport', () => {
    send({ type: 'dapta-forms:scroll-into-view' });
    expect(scrolled).toEqual([{ behavior: 'smooth', block: 'start' }]);
  });

  it('scrolls when the top is below the viewport too', () => {
    top = 1400;
    send({ type: 'dapta-forms:scroll-into-view' });
    expect(scrolled).toHaveLength(1);
  });

  it('leaves the page alone when the frame top is already on screen', () => {
    top = 120;
    send({ type: 'dapta-forms:scroll-into-view' });
    expect(scrolled).toEqual([]);
  });

  it('jumps without animation for a visitor who asked for reduced motion', () => {
    reduced = true;
    send({ type: 'dapta-forms:scroll-into-view' });
    expect(scrolled).toEqual([{ behavior: 'auto', block: 'start' }]);
  });

  it('ignores a request that is not from one of our frames', () => {
    send({ type: 'dapta-forms:scroll-into-view' }, window);
    const stranger = document.createElement('iframe');
    document.body.append(stranger);
    send({ type: 'dapta-forms:scroll-into-view' }, stranger.contentWindow);
    stranger.remove();
    expect(scrolled).toEqual([]);
  });
});

describe('embed.js: dapta-forms:resize (unchanged)', () => {
  it('sizes our frame to the reported height, shrinking included', () => {
    send({ type: 'dapta-forms:resize', height: 1265 });
    expect(frame.style.height).toBe('1265px');
    send({ type: 'dapta-forms:resize', height: 480 });
    expect(frame.style.height).toBe('480px');
  });
});
