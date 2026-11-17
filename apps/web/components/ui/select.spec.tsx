// @vitest-environment happy-dom
/**
 * The Select's wiring: what it measures, when it measures again, and what it
 * does with a key. happy-dom has no layout engine, so the geometry here is
 * made up (every box answers `getBoundingClientRect` from a small table) and
 * the point is the SEQUENCE: the component must read the right boxes at the
 * right moments and hand them to `select-fit.ts`, whose arithmetic has its own
 * spec. Where the real boxes land is qa/component/select-menu-fit.spec.ts.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Select, type SelectOption } from './select';

const SHORT: SelectOption[] = ['Email', 'Phone', 'Company'].map((label) => ({ value: label.toLowerCase(), label }));
const LONG: SelectOption = { value: 'long', label: 'Where should we send the checklist?' };
const LONGER: SelectOption = { value: 'longer', label: 'Which of your current tools should it replace first?' };

/** A label's width in this spec's made-up font: 8px a character, 24px of padding around it. */
const widthOf = (label: string) => label.length * 8 + 24;

/** The window, and where the Select's root sits in it. Tests move these. */
const layout = { viewport: 1000, rootLeft: 100, rootWidth: 200, labelOverflows: false };

const isPanel = (el: Element) => el.querySelector(':scope > [role="listbox"]') !== null;
const isRoot = (el: Element) => el.querySelector(':scope > button[aria-haspopup="listbox"]') !== null;

const rect = (left: number, width: number) =>
  ({ left, right: left + width, width, top: 0, bottom: 0, height: 0, x: left, y: 0, toJSON: () => ({}) }) as DOMRect;

class FakeResizeObserver {
  static live = new Set<FakeResizeObserver>();
  observed: Element[] = [];
  constructor(readonly callback: () => void) {
    FakeResizeObserver.live.add(this);
  }
  observe(el: Element) {
    this.observed.push(el);
  }
  unobserve() {}
  disconnect() {
    FakeResizeObserver.live.delete(this);
  }
  /** Every observer watching an element that matches, as a layout change would. */
  static fire(match: (el: Element) => boolean) {
    for (const observer of FakeResizeObserver.live) if (observer.observed.some(match)) observer.callback();
  }
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  Element.prototype.scrollIntoView = () => {};

  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (isRoot(this)) return rect(layout.rootLeft, layout.rootWidth);
    if (isPanel(this)) {
      // What a `w-max` panel would be: its widest rendered row, and no narrower
      // than the trigger unless the component lifted that floor to measure.
      const rows = [...this.querySelectorAll('[role="option"]')].map((li) => widthOf(li.textContent ?? ''));
      const content = Math.max(0, ...rows);
      return rect(layout.rootLeft, this.style.minWidth === '0' ? content : Math.max(content, layout.rootWidth));
    }
    return rect(0, layout.viewport);
  });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get(this: HTMLElement) {
      // The trigger's label: one pixel short of its text when it is truncated.
      if (this.tagName === 'SPAN') return 100;
      return layout.viewport;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.tagName === 'SPAN' && layout.labelOverflows ? 101 : 100;
    },
  });
});

let host: HTMLDivElement;
let root: Root;
let onChange: ReturnType<typeof vi.fn>;

beforeEach(() => {
  Object.assign(layout, { viewport: 1000, rootLeft: 100, rootWidth: 200, labelOverflows: false });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  onChange = vi.fn();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  expect(FakeResizeObserver.live.size, 'every observer is disconnected on unmount').toBe(0);
});

function render(options: SelectOption[], props: Partial<Parameters<typeof Select>[0]> = {}) {
  act(() => {
    root.render(<Select value="email" onChange={onChange} options={options} searchable ariaLabel="Field" {...props} />);
  });
}

const trigger = () => host.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]')!;
const panel = () => host.querySelector<HTMLElement>('[role="listbox"]')?.parentElement ?? null;
const search = () => host.querySelector<HTMLInputElement>('input')!;
const rows = () => [...host.querySelectorAll('[role="option"]')].map((li) => li.textContent);

function open() {
  act(() => trigger().click());
}
function type(query: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(search(), query);
    search().dispatchEvent(new Event('input', { bubbles: true }));
  });
}
function press(target: Element, key: string) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

describe('Select', () => {
  it('lets its root shrink as a flex or grid item', () => {
    render(SHORT);
    expect(trigger().parentElement!.className.split(' ')).toContain('min-w-0');
  });

  it('pins the menu, as it opens, to the width its longest option asks for', () => {
    render([...SHORT, LONG]);
    open();
    expect(panel()!.style.width).toBe(`${widthOf(LONG.label)}px`);
    expect(panel()!.className).toContain('left-0');
    // The floor it lifted to measure is back.
    expect(panel()!.style.minWidth).toBe('');
  });

  it('is never narrower than its trigger', () => {
    render(SHORT);
    open();
    expect(panel()!.style.width).toBe('200px');
  });

  it('keeps that width while the search box filters the list', () => {
    render([...SHORT, LONG]);
    open();
    const pinned = panel()!.style.width;
    for (const query of ['pho', 'zzz', '']) {
      type(query);
      expect(panel()!.style.width, `after typing "${query}"`).toBe(pinned);
    }
    type('pho');
    expect(rows()).toEqual(['Phone']);
  });

  it('measures again when the option list itself changes, filter or no filter', () => {
    render(SHORT);
    open();
    expect(panel()!.style.width).toBe('200px');

    // The list finishes loading with the menu open.
    render([...SHORT, LONG]);
    expect(panel()!.style.width).toBe(`${widthOf(LONG.label)}px`);

    // And changes again under a filter that hides the new, longer option: the
    // width comes from the whole list, and the filter is still applied after.
    type('pho');
    render([...SHORT, LONG, LONGER]);
    expect(panel()!.style.width).toBe(`${widthOf(LONGER.label)}px`);
    expect(rows()).toEqual(['Phone']);
    expect(search().value).toBe('pho');
  });

  it('does not measure again for a new array holding the same options', () => {
    const measure = vi.mocked(HTMLElement.prototype.getBoundingClientRect);
    render([...SHORT, LONG]);
    open();
    const panelReads = () => measure.mock.contexts.filter((el) => isPanel(el as Element)).length;
    const before = panelReads();
    render([...SHORT, LONG].map((o) => ({ ...o })));
    expect(panelReads()).toBe(before);
  });

  it('flips to the right edge of a trigger near the right edge of the window', () => {
    Object.assign(layout, { rootLeft: 780 });
    render([...SHORT, LONG]);
    open();
    expect(panel()!.className).toContain('right-0');
    expect(panel()!.style.width).toBe(`${widthOf(LONG.label)}px`);
  });

  it('places again when the Select or a clipping ancestor changes size, and on a window resize', () => {
    render([...SHORT, LONG]);
    open();
    expect(panel()!.className).toContain('left-0');

    // The layout around it changes with no window resize: the trigger now sits
    // near the right edge.
    layout.rootLeft = 780;
    act(() => FakeResizeObserver.fire(isRoot));
    expect(panel()!.className).toContain('right-0');

    // And the window itself narrows until neither side holds the menu.
    Object.assign(layout, { viewport: 300, rootLeft: 40, rootWidth: 120 });
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(panel()!.className).toContain('left-0');
    expect(panel()!.style.width).toBe('252px');

    // Closed, it watches nothing.
    press(search(), 'Escape');
    expect(FakeResizeObserver.live.size).toBe(1);
  });

  it('Escape closes the menu and goes no further; with no menu open it belongs to the host', () => {
    // Two kinds of host. A dialog listens on `window`, above React's root. A
    // popover listens on `document`, which in the app IS React's root, so its
    // listener sits beside React's own instead of above it; `host` is the
    // root here, so a listener on `host` stands in for that one.
    // And a third: a React ancestor with its own `onKeyDown`.
    const onWindow = vi.fn();
    const besideReact = vi.fn();
    const inReact = vi.fn();
    window.addEventListener('keydown', onWindow);
    host.addEventListener('keydown', besideReact);
    try {
      act(() => {
        root.render(
          <div onKeyDown={inReact}>
            <Select value="email" onChange={onChange} options={[...SHORT, LONG]} searchable ariaLabel="Field" />
          </div>,
        );
      });
      open();
      press(search(), 'Escape');
      expect(panel(), 'the menu closed').toBeNull();
      expect(document.activeElement).toBe(trigger());
      expect(onWindow, 'a dialog listening on window never saw it').not.toHaveBeenCalled();
      expect(besideReact, 'nor did a listener on the same node as React').not.toHaveBeenCalled();
      expect(inReact, 'nor did a React ancestor').not.toHaveBeenCalled();

      press(trigger(), 'Escape');
      expect(onWindow).toHaveBeenCalledTimes(1);
      expect(besideReact).toHaveBeenCalledTimes(1);
      expect(inReact).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('keydown', onWindow);
      host.removeEventListener('keydown', besideReact);
    }
  });

  it('leaves every other key to bubble', () => {
    const onWindow = vi.fn();
    window.addEventListener('keydown', onWindow);
    try {
      render([...SHORT, LONG]);
      open();
      press(search(), 'ArrowDown');
      press(search(), 'a');
      expect(onWindow).toHaveBeenCalledTimes(2);
    } finally {
      window.removeEventListener('keydown', onWindow);
    }
  });

  it('gives a truncated trigger its full label as a title, and leaves its accessible name alone', () => {
    layout.labelOverflows = true;
    render([...SHORT, LONG], { value: 'long' });
    expect(trigger().getAttribute('title')).toBe(LONG.label);
    expect(trigger().getAttribute('aria-label')).toBe('Field');
  });

  it('gives a label that fits no title', () => {
    render([...SHORT, LONG], { value: 'long' });
    expect(trigger().hasAttribute('title')).toBe(false);
  });
});
