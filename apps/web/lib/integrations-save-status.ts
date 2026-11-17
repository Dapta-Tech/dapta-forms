'use client';

import { useSyncExternalStore } from 'react';

/**
 * The Connect tab's integrations save, as the editor's topbar needs to know it.
 *
 * The topbar's "Saved" dot is driven by the builder's own autosave, while the
 * integrations on the Connect tab save through a separate one. With the API
 * down the two disagreed: the tab said the integrations were not saved and the
 * topbar kept saying "Saved" in green. This is the one place the integrations
 * save reports to, so the topbar can show the worse of the two.
 *
 * A module singleton keyed by form id, like `connect-sync`: it outlives the
 * tab's mount, so a failure is still shown after the author leaves the tab,
 * until a later save succeeds.
 */
export type IntegrationsSaveState = {
  /**
   * `partial`: saved, except one card that was left out (a webhook URL that is
   * not valid). NOT saved for that card, so it ranks above `saved`.
   */
  status: 'saved' | 'saving' | 'partial' | 'retrying' | 'error';
  detail?: string | null;
  /** The save failed after the tab unmounted: the change is not stored. */
  lost?: boolean;
};

const states = new Map<string, IntegrationsSaveState>();
const listeners = new Set<() => void>();

export function publishIntegrationsSave(formId: string, next: IntegrationsSaveState): void {
  const prev = states.get(formId);
  if (prev && prev.status === next.status && prev.detail === next.detail && prev.lost === next.lost) return;
  states.set(formId, next);
  for (const listener of listeners) listener();
}

export function readIntegrationsSave(formId: string): IntegrationsSaveState | undefined {
  return states.get(formId);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The integrations save state for a form, or undefined before it has one. */
export function useIntegrationsSave(formId: string): IntegrationsSaveState | undefined {
  return useSyncExternalStore(
    subscribe,
    () => states.get(formId),
    () => undefined,
  );
}

/**
 * Rank of a save state, worst highest, for showing two saves as one.
 * A conflict outranks an error: it is the one the person has to act on (pick
 * a version), while an error retries on its own.
 */
const SAVE_RANK = { saved: 0, saving: 1, partial: 2, retrying: 3, error: 4, conflict: 5 } as const;
type SaveRankKey = keyof typeof SAVE_RANK;

/** The worse of the form's own save and the integrations' save. */
export function worseSaveStatus<T extends SaveRankKey>(form: T, integrations: SaveRankKey | undefined): T | SaveRankKey {
  if (!integrations) return form;
  return SAVE_RANK[integrations] > SAVE_RANK[form] ? integrations : form;
}
