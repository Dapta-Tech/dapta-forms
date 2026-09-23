'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * A question as a column heading: at most two lines, and the whole question in
 * a small card on hover when the two lines cut it. A header row that grew with
 * its longest question pushed every row below it down the screen, and one
 * five-line question set the height for all of them.
 *
 * The card only exists when the text is actually cut (measured, and measured
 * again whenever the column changes width), so a short question gets no hover
 * that repeats it. It is `aria-hidden`: the full question is already in the
 * heading's own text, which the clamp only hides visually.
 */
export function ColumnHeading({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [clamped, setClamped] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setClamped(el.scrollHeight > el.clientHeight + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text]);

  return (
    <span className="group/heading relative block">
      <span ref={ref} className="line-clamp-2" data-testid="column-heading">
        {text}
      </span>
      {clamped ? (
        <span
          aria-hidden
          data-testid="column-heading-full"
          className="pointer-events-none invisible absolute inset-x-0 top-full z-30 mt-2 rounded-md border border-border bg-popover px-3 py-2 text-xs font-normal leading-relaxed text-foreground opacity-0 shadow-lg transition-opacity delay-150 group-hover/heading:visible group-hover/heading:opacity-100"
        >
          {text}
        </span>
      ) : null}
    </span>
  );
}
