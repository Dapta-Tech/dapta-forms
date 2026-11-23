'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { readReferralProgress } from '@/app/admin/referral-actions';
import { useToast } from '@/components/toast';
import { captureEvent } from '@/lib/product-analytics';
import {
  readReferralSeen,
  referralMoment,
  referralSeenKey,
  referralToastText,
  writeReferralSeen,
  type ReferralSeen,
} from '@/lib/referral-moments';
import { ReferralCelebration } from './referral-celebration';
import type { ReferralMessages } from './referral-share-modal';

/**
 * The shortest gap between two reads of the count. Coming back to the tab
 * fires both `focus` and `visibilitychange`; one read covers both.
 */
export const REFERRAL_REFRESH_GAP_MS = 10_000;

/**
 * The referral program's live moments, mounted once in the admin shell while
 * the program is on: a toast when the person's count went up since the last
 * count they saw in this browser, and the celebration, once, when the unlock
 * flips on compared with the last state they saw. The first sight of a person
 * in a browser shows neither: it only remembers where they are.
 *
 * The count comes from the server render (the dashboard load) and is read
 * again, lightly, when the window gets focus or the tab comes back into view.
 * Never on a timer. When the read finds a change, the server render is
 * refreshed too, so the menu entry and the banner show the same count as the
 * toast.
 */
export function ReferralMoments({
  link,
  count,
  goal,
  unlocked,
  badgeLabel,
  m,
}: {
  link: string;
  count: number;
  goal: number;
  unlocked: boolean;
  /** The badge's localized label (`growth.madeWith`). */
  badgeLabel: string;
  m: ReferralMessages;
}) {
  const router = useRouter();
  const toast = useToast();
  // The toast API is a new object on every render of its provider.
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const [celebrating, setCelebrating] = useState(false);
  const key = referralSeenKey(link);
  const shown = useRef<ReferralSeen>({ count, unlocked });
  shown.current = { count, unlocked };

  const observe = useCallback(
    (now: ReferralSeen) => {
      const { moment, next } = referralMoment(readReferralSeen(key), now);
      writeReferralSeen(key, next);
      if (moment.kind === 'celebrate') {
        setCelebrating(true);
        captureEvent('referral_celebration_shown');
      }
      if (moment.kind === 'toast') {
        toastRef.current.success(referralToastText(m.toast, moment, goal));
        captureEvent('referral_toast_shown', { count: moment.count });
      }
    },
    [key, goal, m],
  );

  // The dashboard load, and each new server render.
  useEffect(() => {
    observe({ count, unlocked });
  }, [observe, count, unlocked]);

  // Focus and the tab coming back: read the count again.
  useEffect(() => {
    let busy = false;
    let last = Date.now();
    const check = async () => {
      if (document.visibilityState === 'hidden') return;
      const t = Date.now();
      if (busy || t - last < REFERRAL_REFRESH_GAP_MS) return;
      busy = true;
      last = t;
      try {
        const r = await readReferralProgress();
        if (!r?.enabled) return;
        const now = { count: r.count, unlocked: r.unlocked === true };
        observe(now);
        if (now.count !== shown.current.count || now.unlocked !== shown.current.unlocked) router.refresh();
      } catch {
        // A failed read is the same as no change.
      } finally {
        busy = false;
      }
    };
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, [observe, router]);

  if (!celebrating) return null;
  return (
    <ReferralCelebration open onClose={() => setCelebrating(false)} goal={goal} badgeLabel={badgeLabel} m={m} />
  );
}
