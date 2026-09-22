'use client';

import { cn } from '@/lib/cn';

/**
 * The branded "x" inside a search box. The browser's own clear button is
 * hidden app-wide (see the `::-webkit-search-cancel-button` rule in
 * globals.css), so every `type="search"` input renders this one instead.
 *
 * Absent while the query is empty. `onClear` empties the query AND puts focus
 * back in the input, so the person can type the next search straight away.
 * Position it absolutely inside the input's `relative` wrapper; `className`
 * sets size and offset for inputs shorter than the default h-10.
 */
export function SearchClearButton({
  query,
  label,
  onClear,
  testId,
  className,
}: {
  query: string;
  label: string;
  onClear: () => void;
  testId?: string;
  className?: string;
}) {
  if (!query) return null;
  return (
    <button
      type="button"
      aria-label={label}
      data-testid={testId}
      onClick={onClear}
      className={cn(
        'absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground',
        className,
      )}
    >
      <i aria-hidden className="pi pi-times" style={{ fontSize: 12 }} />
    </button>
  );
}
