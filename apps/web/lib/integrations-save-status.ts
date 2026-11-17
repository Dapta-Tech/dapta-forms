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
  /**
   * The lost change was already said in a toast. A lost change is announced
   * ONCE, wherever the author is when it happens; without this every visit to
   * the Connect tab said it again.
   */
  announced?: boolean;
};

const states = new Map<string, IntegrationsSaveState>();
const listeners = new Set<() => void>();

export function publishIntegrationsSave(formId: string, next: IntegrationsSaveState): void {
  const prev = states.get(formId);
  if (
    prev &&
    prev.status === next.status &&
    prev.detail === next.detail &&
    prev.lost === next.lost &&
    prev.announced === next.announced
  ) {
    return;
  }
  states.set(formId, next);
  recombine(formId);
  for (const listener of listeners) listener();
}

/** The lost change has been said in a toast: do not say it again. */
export function markLostSaveAnnounced(formId: string): void {
  const prev = states.get(formId);
  if (prev?.lost && !prev.announced) publishIntegrationsSave(formId, { ...prev, announced: true });
}

/**
 * The author read the "your last change was not saved" notice and dismissed
 * it. What the tab shows by then is the server's real state, so there is
 * nothing left unsaved to report: the error clears. Only a lost change can be
 * acknowledged; a save that is failing right now cannot be waved away.
 */
export function acknowledgeLostIntegrationsSave(formId: string): void {
  if (states.get(formId)?.lost) publishIntegrationsSave(formId, { status: 'saved' });
}

/** Forms whose Connect tab is on screen right now. */
const connectOpen = new Set<string>();

/**
 * The Connect tab is on screen (or no longer is) for this form.
 *
 * `partial` is a statement about a CARD on that tab (a webhook switched on
 * with no URL is not stored), not a save in progress. While the tab is open it
 * is the save state, in the topbar and the pill. Once the author is elsewhere
 * it would sit on the topbar indefinitely and hide the builder's own "Saving"
 * and "Saved", so there the topbar speaks for the builder alone and the
 * condition is marked on the Connect tab itself (`ConnectTabMark`). A save
 * that failed, or a change that was lost, is different: that is unsaved work,
 * and it stays in the topbar wherever the author is.
 */
export function setConnectTabOpen(formId: string, open: boolean): void {
  if (open === connectOpen.has(formId)) return;
  if (open) connectOpen.add(formId);
  else connectOpen.delete(formId);
  recombine(formId);
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

/**
 * The reason shown under the topbar's indicator: the reason of whichever save
 * is at the state shown, and BOTH when both are (the form's draft and the
 * integrations can fail for different reasons, and naming one hides the other).
 */
export function saveStatusReason(
  shown: string,
  form: { status: string; detail: string | null },
  integrations: IntegrationsSaveState | undefined,
): string | null {
  const reasons: string[] = [];
  if (form.status === shown && form.detail?.trim()) reasons.push(form.detail.trim());
  if (integrations && integrations.status === shown && shown !== 'saved' && integrations.detail?.trim()) {
    reasons.push(integrations.detail.trim());
  }
  return reasons.length ? reasons.join(' · ') : null;
}

/** The form's own (builder) save, as the editor's autosave reports it. */
export type FormSaveState = { status: 'saved' | 'saving' | 'retrying' | 'error' | 'conflict'; detail: string | null };

/** What BOTH indicators show: one object, so they cannot read two different versions. */
export interface CombinedSaveState {
  status: 'saved' | 'saving' | 'partial' | 'retrying' | 'error' | 'conflict';
  detail: string | null;
  /** The integrations' last change was lost after the tab was left. */
  lost: boolean;
}

const formStates = new Map<string, FormSaveState>();
const combined = new Map<string, CombinedSaveState>();
const SAVED: CombinedSaveState = { status: 'saved', detail: null, lost: false };

function recombine(formId: string): void {
  const form = formStates.get(formId) ?? { status: 'saved', detail: null };
  const raw = states.get(formId);
  // Away from the Connect tab, a card left out of the save does not speak for
  // the whole editor (see `setConnectTabOpen`).
  const integrations = raw?.status === 'partial' && !connectOpen.has(formId) ? undefined : raw;
  const status = worseSaveStatus(form.status, integrations?.status);
  const next: CombinedSaveState = {
    status,
    detail: saveStatusReason(status, form, integrations),
    lost: integrations?.status === status && !!integrations.lost,
  };
  const prev = combined.get(formId);
  if (prev && prev.status === next.status && prev.detail === next.detail && prev.lost === next.lost) return;
  combined.set(formId, next);
}

/** The editor reports its own (builder) save here, beside the integrations'. */
export function publishFormSave(formId: string, next: FormSaveState): void {
  const prev = formStates.get(formId);
  if (prev && prev.status === next.status && prev.detail === next.detail) return;
  formStates.set(formId, next);
  recombine(formId);
  for (const listener of listeners) listener();
}

/**
 * The state the topbar AND the save pill render, from one snapshot. Both read
 * this hook, so in any render they show the same thing; reading the builder's
 * status from React state in one and from a store in the other is what left
 * 60 to 90 ms windows where they disagreed.
 */
export function useCombinedSave(formId: string): CombinedSaveState {
  return useSyncExternalStore(
    subscribe,
    () => combined.get(formId) ?? SAVED,
    () => SAVED,
  );
}

/** The combined state outside React (specs, and anything that must not subscribe). */
export function readCombinedSave(formId: string): CombinedSaveState {
  return combined.get(formId) ?? SAVED;
}
