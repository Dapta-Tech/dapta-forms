'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { cn } from '@/lib/cn';

/**
 * A small "i" affordance that explains a control in place (V5-B5).
 *
 * Built for the panels where a full hint line does not fit — a column header, a
 * label in a 3-across grid — and where leaving the meaning implicit costs more
 * than the pixel: the options `value` column, the phone digit floor, the outcome
 * heading, the HubSpot property pickers. Those are exactly the fields the
 * verification pass came back confused about.
 *
 * Opens on hover AND on click/Enter/Space, so it works with a pointer, a
 * keyboard, and a touch screen (where hover does not exist). Escape or a click
 * outside closes it. The bubble is `role="tooltip"` and wired to the trigger
 * through `aria-describedby`, so a screen reader announces the text with the
 * control instead of stranding it as loose prose.
 */
export function HelpTip({
  text,
  label,
  className,
  side = 'top',
}: {
  /** The explanation. Plain text — keep it to a sentence or two. */
  text: string;
  /** Accessible name for the trigger, e.g. "What is Value?". */
  label: string;
  className?: string;
  /** Which way the bubble opens; flip to `bottom` near the top of a panel. */
  side?: 'top' | 'bottom';
}) {
  // Two independent reasons to be open, because they behave differently:
  // `hovered` follows the pointer/focus and closes itself, while `pinned` is a
  // deliberate click that STAYS open. Folding both into one boolean meant the
  // click (or Enter/Space, which fires click) toggled off the state that focus
  // had just turned on — so the keyboard could never open the tip at all.
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const open = hovered || pinned;
  const id = useId();
  const wrapRef = useRef<HTMLSpanElement>(null);

  // Dismiss on outside click / Escape — a tooltip pinned open by a click would
  // otherwise sit over the next control the author reaches for.
  useEffect(() => {
    if (!open) return;
    function onDocDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setPinned(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setPinned(false);
        setHovered(false);
      }
    }
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <span ref={wrapRef} className={cn('relative inline-flex', className)}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        data-testid="help-tip-trigger"
        onClick={() => setPinned((v) => !v)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <i aria-hidden className="pi pi-info-circle" style={{ fontSize: 11 }} />
      </button>
      {open ? (
        <span
          role="tooltip"
          id={id}
          data-testid="help-tip-bubble"
          className={cn(
            'absolute left-1/2 z-50 w-56 -translate-x-1/2 rounded-md border border-border bg-popover px-2.5 py-2',
            'text-[11px] font-normal leading-relaxed text-popover-foreground shadow-lg',
            side === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5',
          )}
        >
          {text}
        </span>
      ) : null}
    </span>
  );
}
