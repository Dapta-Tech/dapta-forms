'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { captureEvent } from '@/lib/product-analytics';

/**
 * Where a copy or a share started: the left-menu entry, the top banner's call
 * to action (`banner`) or its "?" (`banner_help`), or the locked badge switch
 * (Brand kit and the Design panel).
 */
export type ReferralSurface = 'menu' | 'banner' | 'banner_help' | 'badge_switch';

/** How long "Copied" stays before the button reads "Copy link" again. */
const COPIED_MS = 2000;

/** The `surface` property the referral events carry, or none when the caller did not say. */
export function surfaceProps(surface: ReferralSurface | undefined): { surface: ReferralSurface } | undefined {
  return surface ? { surface } : undefined;
}

/**
 * Copy the referral link to the clipboard and record `referral_link_copied`.
 * `copy()` resolves false when the clipboard refuses (an insecure origin, a
 * denied permission): nothing is recorded then, and the caller hands the link
 * over another way. `copied` is true for a moment after a copy that worked.
 */
export function useReferralCopy(link: string, surface?: ReferralSurface) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = useCallback(async (): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      return false;
    }
    setCopied(true);
    captureEvent('referral_link_copied', surfaceProps(surface));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), COPIED_MS);
    return true;
  }, [link, surface]);

  const reset = useCallback(() => setCopied(false), []);
  return { copied, copy, reset };
}
