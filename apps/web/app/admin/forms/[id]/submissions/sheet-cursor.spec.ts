/**
 * The sheet's cell cursor: where an arrow key takes it, and that it stops at
 * the edges instead of wrapping or leaving the table.
 */
import { describe, expect, it } from 'vitest';
import { arrowDirection, clampCursor, moveCursor } from './sheet-cursor';

describe('moveCursor', () => {
  it('starts on the first cell whatever the first arrow is', () => {
    for (const dir of ['up', 'down', 'left', 'right'] as const) {
      expect(moveCursor(null, dir, 3, 4)).toEqual({ row: 0, col: 0 });
    }
  });

  it('moves one cell per arrow', () => {
    const c = { row: 1, col: 1 };
    expect(moveCursor(c, 'up', 3, 4)).toEqual({ row: 0, col: 1 });
    expect(moveCursor(c, 'down', 3, 4)).toEqual({ row: 2, col: 1 });
    expect(moveCursor(c, 'left', 3, 4)).toEqual({ row: 1, col: 0 });
    expect(moveCursor(c, 'right', 3, 4)).toEqual({ row: 1, col: 2 });
  });

  it('stops at every edge', () => {
    expect(moveCursor({ row: 0, col: 0 }, 'up', 3, 4)).toEqual({ row: 0, col: 0 });
    expect(moveCursor({ row: 0, col: 0 }, 'left', 3, 4)).toEqual({ row: 0, col: 0 });
    expect(moveCursor({ row: 2, col: 3 }, 'down', 3, 4)).toEqual({ row: 2, col: 3 });
    expect(moveCursor({ row: 2, col: 3 }, 'right', 3, 4)).toEqual({ row: 2, col: 3 });
  });

  it('has nowhere to go on an empty table', () => {
    expect(moveCursor(null, 'down', 0, 0)).toBeNull();
    expect(moveCursor({ row: 0, col: 0 }, 'down', 0, 4)).toBeNull();
  });
});

describe('clampCursor', () => {
  it('pulls a cursor back onto a table that shrank', () => {
    expect(clampCursor({ row: 9, col: 2 }, 3, 4)).toEqual({ row: 2, col: 2 });
    expect(clampCursor({ row: 1, col: 7 }, 3, 4)).toEqual({ row: 1, col: 3 });
  });
});

describe('arrowDirection', () => {
  it('names the four arrows and nothing else', () => {
    expect(arrowDirection('ArrowUp')).toBe('up');
    expect(arrowDirection('ArrowRight')).toBe('right');
    expect(arrowDirection('Enter')).toBeNull();
    expect(arrowDirection('a')).toBeNull();
  });
});
