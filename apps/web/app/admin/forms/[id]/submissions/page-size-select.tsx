'use client';

import { useId, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { DEFAULT_PAGE_SIZE, PAGE_SIZES, SIZE_PARAM, type PageSize } from './viewer-params';

/**
 * Rows per page, next to the range under the table. The choice goes in the
 * address bar (`?size=`), so it survives a reload and every page link.
 *
 * The URL is read from `window.location` rather than from the server's props:
 * the viewer rewrites the address bar in place (the open response, the sheet),
 * and the new page must keep those. The offset is snapped to the page that
 * holds the first row on screen now, so the reader does not jump back to 1.
 */
export function PageSizeSelect({ value, label }: { value: PageSize; label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const id = useId();

  const onChange = (size: number) => {
    const q = new URLSearchParams(window.location.search);
    const offset = Math.max(0, Number(q.get('offset')) || 0);
    const snapped = Math.floor(offset / size) * size;
    if (size === DEFAULT_PAGE_SIZE) q.delete(SIZE_PARAM);
    else q.set(SIZE_PARAM, String(size));
    if (snapped > 0) q.set('offset', String(snapped));
    else q.delete('offset');
    const query = q.toString();
    start(() => router.push(query ? `?${query}` : window.location.pathname, { scroll: false }));
  };

  return (
    <span className="inline-flex items-center gap-2" aria-busy={pending}>
      <label htmlFor={id} className="hidden whitespace-nowrap text-muted-foreground sm:inline">
        {label}
      </label>
      <select
        id={id}
        aria-label={label}
        data-testid="page-size"
        value={value}
        disabled={pending}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-8 cursor-pointer rounded-md border border-border bg-card px-2 text-sm font-medium tabular-nums text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
      >
        {PAGE_SIZES.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </span>
  );
}
