/**
 * The fallback that holds the old picture while a keyed Suspense swaps its
 * content. The copy itself needs a live DOM (the Playwright run covers it);
 * here: what the server draws, and what a capture keeps.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { capture, HeldFallback, SwapHold } from './swap-hold';

describe('HeldFallback', () => {
  it('draws its children when there is nothing to copy (the first load, the server)', () => {
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
});

describe('capture', () => {
  const el = (scrollTop: number, scrollLeft: number) => ({ scrollTop, scrollLeft });

  it('keeps the markup and only the scrolled elements, by position', () => {
    const nodes = [el(0, 0), el(120, 0), el(0, 0), el(0, 340)];
    const region = {
      childElementCount: 1,
      innerHTML: '<div data-sheet="">rows</div>',
      querySelectorAll: () => nodes,
    } as unknown as HTMLElement;
    expect(capture(region)).toEqual({
      html: '<div data-sheet="">rows</div>',
      scrolls: [
        [1, 120, 0],
        [3, 0, 340],
      ],
    });
  });

  it('has nothing to copy from an empty or missing region', () => {
    expect(capture(null)).toBeNull();
    expect(capture({ childElementCount: 0 } as unknown as HTMLElement)).toBeNull();
  });
});
