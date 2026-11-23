'use client';

import { useRef } from 'react';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { useReferralCopy, type ReferralSurface } from './use-referral-copy';

/**
 * The person's referral link, read-only, with a copy button, at the size of a
 * settings row: the locked badge switch's (Brand kit and the Design panel).
 * A copy records `referral_link_copied` with its `surface`. Without a
 * clipboard (an insecure origin, a denied permission) the link is handed over
 * selected instead, so the keyboard shortcut copies it.
 */
export function ReferralLinkField({
  link,
  label,
  copy,
  copied,
  inputId,
  surface,
}: {
  link: string;
  label: string;
  copy: string;
  copied: string;
  /** Unique on the page: the label points at it. */
  inputId: string;
  surface?: ReferralSurface;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { copied: done, copy: copyLink } = useReferralCopy(link, surface);
  const onCopy = async () => {
    if (await copyLink()) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  };

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={inputId} className="text-xs font-medium text-foreground">
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
          className="h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-xs text-foreground"
        />
        <button
          type="button"
          onClick={onCopy}
          data-testid="referral-copy"
          aria-live="polite"
          className={cn(buttonVariants({ variant: 'outline' }), 'h-9 shrink-0')}
        >
          {done ? copied : copy}
        </button>
      </div>
    </div>
  );
}
