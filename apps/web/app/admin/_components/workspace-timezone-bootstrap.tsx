'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { t } from '@quill/shared';
import { useToast } from '@/components/toast';
import { browserTimezone } from '@/lib/timezones';
import { callAction } from '@/lib/call-action';
import { claimWorkspaceTimezoneAction } from '@/app/admin/workspace-actions';

/** One attempt per tab session, so a refused or slow claim is not retried on every page. */
const CLAIM_KEY = 'forms.timezone.claimed';

/**
 * Seeds the workspace timezone from the first admin's browser. Renders
 * nothing. Runs once per tab session, only while the workspace has no zone
 * and the viewer may set one; the API keeps the value only while the column
 * is still NULL, so two admins racing cannot flip it. Says so with a toast
 * (naming where to change it) only when THIS browser's zone was the one kept.
 */
export function WorkspaceTimezoneBootstrap({
  timezone,
  canClaim,
  message,
}: {
  timezone: string | null;
  canClaim: boolean;
  /** `admin.chrome.timezoneAutoSet`, with a `{zone}` placeholder. */
  message: string;
}) {
  const toast = useToast();
  const router = useRouter();
  useEffect(() => {
    if (timezone != null || !canClaim) return;
    try {
      if (sessionStorage.getItem(CLAIM_KEY)) return;
      sessionStorage.setItem(CLAIM_KEY, '1');
    } catch {
      // No storage (private mode, hardened browser): still try once per mount.
    }
    const zone = browserTimezone();
    if (!zone) return;
    let cancelled = false;
    void callAction(() => claimWorkspaceTimezoneAction(zone)).then((res) => {
      if (cancelled || !res || !('applied' in res) || !res.applied) return;
      toast.success(t(message, { zone }));
      router.refresh();
    });
    return () => {
      cancelled = true;
    };
  }, [timezone, canClaim, message, toast, router]);
  return null;
}
