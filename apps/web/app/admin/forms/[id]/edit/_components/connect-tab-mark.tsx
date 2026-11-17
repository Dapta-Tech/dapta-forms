'use client';

import { useEffect } from 'react';

import { useToast } from '@/components/toast';
import { markLostSaveAnnounced, useIntegrationsSave } from '@/lib/integrations-save-status';

/**
 * A mark on the Connect tab's label while something on that tab is not stored.
 *
 * Two things put it there. A card left out of the save (a webhook switched on
 * with no URL): that is true until the author goes back and fixes it, but it
 * is not the editor's save state, so away from Connect the topbar speaks for
 * the builder alone and this mark is where the condition lives. And a change
 * that was lost after the tab was left, which also stays an error in the
 * topbar until it is acknowledged on the tab.
 *
 * It is also where a lost change is announced, ONCE, wherever the author is
 * when the retries give up: the Connect tab is not on screen then, and the
 * topbar's status is hidden on narrower windows.
 */
export function ConnectTabMark({ formId }: { formId: string }) {
  const state = useIntegrationsSave(formId);
  const { error } = useToast();
  const lost = !!state?.lost;
  const announced = !!state?.announced;
  const detail = state?.detail ?? null;
  useEffect(() => {
    if (!lost || announced) return;
    markLostSaveAnnounced(formId);
    if (detail) error(detail);
  }, [formId, lost, announced, detail, error]);

  const reason = lost || state?.status === 'partial' ? detail : null;
  if (!reason) return null;
  return (
    <span data-testid="connect-tab-mark" data-kind={lost ? 'lost' : 'partial'} title={reason} className="flex items-center">
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${lost ? 'bg-destructive' : 'bg-warning'}`} />
      <span className="sr-only">{reason}</span>
    </span>
  );
}
