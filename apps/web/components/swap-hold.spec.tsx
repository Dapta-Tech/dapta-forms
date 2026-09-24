// @vitest-environment happy-dom
/**
 * The fallback that holds the old picture while a keyed Suspense swaps its
 * content: on the server and on a first load it draws the skeleton; on a swap
 * it draws a clone of what was on screen, scrolled where it was, until the
 * new content lands.
 */
import { act, Suspense, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { capture, HeldFallback, SwapHold } from './swap-hold';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A child that suspends until `release` is called. */
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((r) => (release = r));
  let done = false;
  void promise.then(() => (done = true));
  function Gate({ children }: { children: ReactNode }) {
    if (!done) throw promise;
    return <>{children}</>;
  }
  return { Gate, release: async () => act(async () => release()) };
}

const view = (key: string, body: ReactNode) => (
  <SwapHold>
    <Suspense
      key={key}
      fallback={
        <HeldFallback>
          <p>skeleton</p>
        </HeldFallback>
      }
    >
      {body}
    </Suspense>
  </SwapHold>
);

let root: Root | null = null;
let host: HTMLDivElement;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  host?.remove();
});

describe('HeldFallback', () => {
  it('draws its children when there is nothing to copy (the server, a first load)', () => {
    const html = renderToStaticMarkup(
      <SwapHold>
        <HeldFallback>
          <p>skeleton</p>
        </HeldFallback>
      </SwapHold>,
    );
    expect(html).toContain('<p>skeleton</p>');
    expect(html).not.toContain('held-fallback');
  });

  it('holds a clone of the old content, scrolled where it was, until the new one lands', async () => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () =>
      root!.render(
        view(
          'a',
          <div data-testid="scroller" style={{ overflow: 'auto' }}>
            <input type="checkbox" defaultChecked data-testid="pick" />
            old rows
          </div>,
        ),
      ),
    );
    const scroller = host.querySelector<HTMLElement>('[data-testid="scroller"]')!;
    scroller.scrollLeft = 240;

    const next = gate();
    await act(async () => root!.render(view('b', <next.Gate>new rows</next.Gate>)));
    const held = host.querySelector('[data-testid="held-fallback"]')!;
    expect(held).not.toBeNull();
    expect(held.hasAttribute('inert')).toBe(true);
    expect(held.textContent).toContain('old rows');
    expect(host.textContent).not.toContain('skeleton');
    expect(held.querySelector<HTMLElement>('[data-testid="scroller"]')!.scrollLeft).toBe(240);
    expect(held.querySelector<HTMLInputElement>('[data-testid="pick"]')!.checked).toBe(true);

    await next.release();
    expect(host.querySelector('[data-testid="held-fallback"]')).toBeNull();
    expect(host.textContent).toBe('new rows');
  });

  it('has nothing to copy from an empty or missing region', () => {
    expect(capture(null)).toBeNull();
    expect(capture(document.createElement('div'))).toBeNull();
  });
});
