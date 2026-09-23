/**
 * The sheet's keyboard cursor: one cell, outlined in the accent, moved with
 * the arrow keys. These helpers read the server-rendered table straight from
 * the DOM: a row is a `tr[data-response-id]`, a cell the cursor can stand on
 * is a `td[data-cell]` (the response, its status, its score and each answer;
 * not the checkbox or the row actions).
 */

export interface Cursor {
  row: number;
  col: number;
}

export type Direction = 'up' | 'down' | 'left' | 'right';

const ARROWS: Record<string, Direction> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

/** The direction an arrow key names, or null for any other key. */
export function arrowDirection(key: string): Direction | null {
  return ARROWS[key] ?? null;
}

/** The table as rows of cursor cells. */
export function cellGrid(root: ParentNode | null): HTMLElement[][] {
  if (!root) return [];
  return [...root.querySelectorAll<HTMLElement>('tr[data-response-id]')].map((row) => [
    ...row.querySelectorAll<HTMLElement>('td[data-cell]'),
  ]);
}

/**
 * One step from `from` (or the first cell when there is no cursor yet), held
 * inside the grid: the edges stop the cursor rather than wrapping it.
 */
export function moveCursor(
  from: Cursor | null,
  dir: Direction,
  rows: number,
  cols: number,
): Cursor | null {
  if (rows <= 0 || cols <= 0) return null;
  if (!from) return { row: 0, col: 0 };
  const row = dir === 'up' ? from.row - 1 : dir === 'down' ? from.row + 1 : from.row;
  const col = dir === 'left' ? from.col - 1 : dir === 'right' ? from.col + 1 : from.col;
  return clampCursor({ row, col }, rows, cols);
}

/** Keep a cursor on the table after it shrank (a delete, a narrower page). */
export function clampCursor(c: Cursor, rows: number, cols: number): Cursor {
  return {
    row: Math.min(Math.max(c.row, 0), Math.max(rows - 1, 0)),
    col: Math.min(Math.max(c.col, 0), Math.max(cols - 1, 0)),
  };
}

/**
 * Scroll the sheet just enough to show `cell` whole, clear of the sticky
 * header and the pinned columns. Measured by hand: `scrollIntoView` does not
 * know the header and the first columns are sticky, so it leaves the cell
 * underneath them, and it would also scroll the page behind the sheet.
 */
export function revealCell(cell: HTMLElement): void {
  const scroller = cell.closest<HTMLElement>('[data-table-scroll]');
  if (!scroller) return;
  const box = scroller.getBoundingClientRect();
  const rect = cell.getBoundingClientRect();
  const header = scroller.querySelector('thead')?.getBoundingClientRect().height ?? 0;
  const viewTop = box.top + scroller.clientTop + header;
  const viewBottom = box.top + scroller.clientTop + scroller.clientHeight;
  if (rect.top < viewTop) scroller.scrollTop -= viewTop - rect.top;
  else if (rect.bottom > viewBottom)
    scroller.scrollTop += Math.min(rect.bottom - viewBottom, rect.top - viewTop);

  // A pinned cell never scrolls sideways; for the rest, the pinned columns
  // end where the last sticky cell of the row ends.
  if (getComputedStyle(cell).position === 'sticky') return;
  const sticky = [...(cell.parentElement?.children ?? [])].filter(
    (el) => getComputedStyle(el).position === 'sticky',
  );
  const pinnedRight = sticky.length
    ? Math.max(...sticky.map((el) => el.getBoundingClientRect().right))
    : box.left + scroller.clientLeft;
  const viewRight = box.left + scroller.clientLeft + scroller.clientWidth;
  if (rect.left < pinnedRight) scroller.scrollLeft -= pinnedRight - rect.left;
  else if (rect.right > viewRight)
    scroller.scrollLeft += Math.min(rect.right - viewRight, rect.left - pinnedRight);
}
