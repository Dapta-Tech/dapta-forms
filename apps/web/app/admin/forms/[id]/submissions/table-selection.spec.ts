/**
 * The selection's one rule: it only ever holds rows on the current page.
 * `useSelection` prunes its set with this on every change of rows, so a page
 * change starts empty and a deleted row drops out.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('./actions', () => ({ deleteSubmissionsAction: vi.fn() }));

import { pruneSelection } from './table-selection';

describe('pruneSelection', () => {
  it('keeps the selected rows still on the page, in page order', () => {
    expect(pruneSelection(new Set(['c', 'a']), ['a', 'b', 'c'])).toEqual(['a', 'c']);
  });

  it('drops ids that left the page (a delete)', () => {
    expect(pruneSelection(new Set(['a', 'b']), ['b', 'c'])).toEqual(['b']);
  });

  it('empties on a page change: none of the old rows are on the new page', () => {
    expect(pruneSelection(new Set(['a', 'b']), ['x', 'y', 'z'])).toEqual([]);
  });
});
