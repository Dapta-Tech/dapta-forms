/**
 * The branded clear button every search box uses now that the browser's own
 * one is hidden (globals.css). Static markup only: the click behaviour (clear
 * and refocus) is driven in a real browser, the web vitest env has no DOM.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SearchClearButton } from './search-clear-button';

const noop = () => {};

describe('SearchClearButton', () => {
  it('renders nothing while the query is empty', () => {
    expect(renderToStaticMarkup(<SearchClearButton query="" label="Clear search" onClear={noop} />)).toBe('');
  });

  it('renders a labelled, non-submitting button once there is a query', () => {
    const html = renderToStaticMarkup(
      <SearchClearButton query="acme" label="Clear search" onClear={noop} testId="x" />,
    );
    expect(html).toContain('type="button"');
    expect(html).toContain('aria-label="Clear search"');
    expect(html).toContain('data-testid="x"');
    expect(html).toContain('pi-times');
  });

  it('lets a shorter input override size and offset', () => {
    const html = renderToStaticMarkup(
      <SearchClearButton query="a" label="Clear" onClear={noop} className="right-1 h-6 w-6" />,
    );
    expect(html).toMatch(/class="[^"]*\bh-6\b[^"]*"/);
    expect(html).not.toMatch(/\bh-7\b/);
    expect(html).not.toMatch(/\bright-2\b/);
  });
});
