'use client';

import { useEffect, useRef, useState } from 'react';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { captureEvent } from '@/lib/product-analytics';

/** How long "Copied" stays on the button before it reads "Copy link" again. */
const COPIED_MS = 2000;

/**
 * The person's referral link, read-only, with a copy button: the share
 * dialog's field, and the locked badge switch's. A copy records
 * `referral_link_copied` (with `surface` when the caller names one, so the
 * funnel tells the dialog from the switch). Without a clipboard (an insecure
 * origin, a denied permission) the link is handed over selected instead, so
 * the keyboard shortcut copies it.
 */
export function ReferralLinkField({
  link,
  label,
  copy,
  copied,
  inputId,
  surface,
  compact = false,
  resetKey,
}: {
  link: string;
  label: string;
  copy: string;
  copied: string;
  /** Unique on the page: the label points at it. */
  inputId: string;
  /** Where the copy happened, for the event. Omitted: no property, as the dialog always sent it. */
  surface?: string;
  /** The settings rows' size: a smaller label and field. */
  compact?: boolean;
  /** Changing it puts the button back to "Copy link" (the dialog closing). */
  resetKey?: unknown;
}) {
  const [done, setDone] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  useEffect(() => {
    setDone(false);
  }, [resetKey]);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      inputRef.current?.focus();
      inputRef.current?.select();
      return;
    }
    setDone(true);
    if (surface) captureEvent('referral_link_copied', { surface });
    else captureEvent('referral_link_copied');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setDone(false), COPIED_MS);
  };

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={inputId} className={cn('font-medium text-foreground', compact ? 'text-xs' : 'text-sm')}>
        {label}
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          ref={inputRef}
          id={inputId}
          data-testid="referral-link"
          readOnly
          value={link}
          onFocus={(e) => e.currentTarget.select()}
          className={cn(
            'min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-foreground',
            compact ? 'h-9 text-xs' : 'h-11 text-sm',
          )}
        />
        <button
          type="button"
          onClick={onCopy}
          data-testid="referral-copy"
          aria-live="polite"
          className={cn(buttonVariants({ variant: compact ? 'outline' : 'default' }), compact ? 'h-9' : 'h-11', 'shrink-0')}
        >
          {done ? copied : copy}
        </button>
      </div>
    </div>
  );
}
