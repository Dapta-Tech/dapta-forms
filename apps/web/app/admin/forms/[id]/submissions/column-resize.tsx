'use client';

import { useEffect, useRef, type PointerEvent } from 'react';
import { columnWidthsKey, columnWidthVar } from './viewer-params';

/** Narrowest and widest a question column can be dragged to, in px. */
const MIN_WIDTH = 96;
const MAX_WIDTH = 720;

type Widths = Record<string, number>;

function readWidths(formId: string): Widths {
  try {
    const raw = window.localStorage.getItem(columnWidthsKey(formId));
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? (parsed as Widths) : {};
  } catch {
    return {};
  }
}

function writeWidth(formId: string, stepKey: string, width: number | null): void {
  try {
    const widths = readWidths(formId);
    if (width == null) delete widths[stepKey];
    else widths[stepKey] = width;
    const key = columnWidthsKey(formId);
    if (Object.keys(widths).length === 0) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(widths));
  } catch {
    // Private mode or storage off: the width holds until the page reloads.
  }
}

function applyWidth(table: HTMLTableElement | null, index: number, width: number | null): void {
  if (!table) return;
  if (width == null) table.style.removeProperty(columnWidthVar(index));
  else table.style.setProperty(columnWidthVar(index), `${width}px`);
}

/**
 * The drag handle on a question heading's right edge. Dragging sets the
 * column's width; a double-click gives it back its default. The width is kept
 * per form in this browser (keyed by the question, so reordering the form does
 * not hand one question another's width), never in the database.
 *
 * It sits wholly inside the heading's right edge: every heading is sticky, so
 * each is its own stacking context, and a handle that overhung into the next
 * heading was painted over by it and never got the pointer.
 *
 * Pointer only: hidden on a touch screen, and out of the Tab order, since the
 * sheet has no keyboard way to size a column and a stop per heading would only
 * slow Tab down.
 */
export function ColumnResizeHandle({
  formId,
  stepKey,
  index,
  label,
}: {
  formId: string;
  stepKey: string;
  index: number;
  label: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);

  // The saved width, once on load: the server cannot read this browser's storage.
  useEffect(() => {
    const saved = readWidths(formId)[stepKey];
    if (typeof saved === 'number' && Number.isFinite(saved)) {
      applyWidth(ref.current?.closest('table') ?? null, index, clamp(saved));
    }
  }, [formId, stepKey, index]);

  const onPointerDown = (e: PointerEvent<HTMLSpanElement>) => {
    if (e.button !== 0) return;
    const handle = e.currentTarget;
    const th = handle.closest('th');
    const table = handle.closest('table');
    if (!th || !table) return;
    e.preventDefault();
    e.stopPropagation();
    handle.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startWidth = th.getBoundingClientRect().width;
    let width = startWidth;
    const body = document.body.style;
    const previous = { cursor: body.cursor, userSelect: body.userSelect };
    body.cursor = 'col-resize';
    body.userSelect = 'none';
    handle.dataset.dragging = '';

    const onMove = (ev: globalThis.PointerEvent) => {
      width = clamp(Math.round(startWidth + ev.clientX - startX));
      applyWidth(table, index, width);
    };
    const onUp = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      body.cursor = previous.cursor;
      body.userSelect = previous.userSelect;
      delete handle.dataset.dragging;
      if (width !== startWidth) writeWidth(formId, stepKey, width);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  };

  return (
    <span
      ref={ref}
      aria-hidden
      title={label}
      data-testid="column-resize"
      onPointerDown={onPointerDown}
      onDoubleClick={(e) => {
        e.stopPropagation();
        applyWidth(e.currentTarget.closest('table'), index, null);
        writeWidth(formId, stepKey, null);
      }}
      className="group/resize absolute inset-y-0 right-0 z-10 flex w-3 cursor-col-resize touch-none justify-end pointer-coarse:hidden"
    >
      <span className="my-2 w-0.5 rounded-full bg-border opacity-0 transition-opacity group-hover/th:opacity-100 group-hover/resize:bg-primary-edge group-data-dragging/resize:bg-primary-edge group-data-dragging/resize:opacity-100" />
    </span>
  );
}

function clamp(width: number): number {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width));
}
