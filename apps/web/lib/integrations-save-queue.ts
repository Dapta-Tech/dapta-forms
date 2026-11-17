'use client';

import { trackDestinationWrite } from './connect-sync';
import { publishIntegrationsSave } from './integrations-save-status';

/**
 * One save queue per form for the Connect tab's integrations, owned here and
 * not by the editor component, so it behaves the same whether or not the tab
 * is still on screen.
 *
 * What it guarantees, and why each one matters:
 *  - Writes are SERIAL. Two saves of the whole destinations array in flight
 *    at once land in whatever order the network chooses.
 *  - Only the LATEST snapshot is ever written once a newer one exists. A save
 *    queued behind another replaces anything older still waiting, and a
 *    failed older write is dropped rather than retried. The bug this exists
 *    for: S1 in flight, the author edits and leaves the tab, the final save
 *    S2 lands, then S1 failed, was retried 1.5 s later and wrote over S2.
 *  - Only the latest snapshot is retried, and only by the queue when nobody
 *    is on the tab to do it (the editor's own controller retries while it is
 *    mounted). Bounded: a few seconds, then an honest "not saved".
 *  - The state the topbar and the save pill show comes from here, from the
 *    latest snapshot's outcome only, so the two indicators can never disagree
 *    and an older failure can never be reported as the current state.
 */

/** What one attempt of a write came back with. */
export type SendOutcome =
  | { ok: true; transport?: false }
  | { ok: false; transport: true; message: string }
  | { ok: false; transport?: false; message?: string };

/** What `enqueue` resolves with for the snapshot it was given. */
export type QueueOutcome<R> =
  | { kind: 'sent'; result: R }
  /** A newer snapshot replaced this one before it was written, or after it failed. */
  | { kind: 'superseded' };

interface Job<R> {
  seq: number;
  send: () => Promise<R>;
  /** Shown instead of "saved" when the write lands (one card was left out). */
  partial: string | null;
  resolve: (outcome: QueueOutcome<R>) => void;
}

interface FormQueue {
  seq: number;
  inFlight: Job<unknown> | null;
  pending: Job<unknown> | null;
  subscribers: number;
  retryTimer: ReturnType<typeof setTimeout> | null;
  idle: Promise<void> | null;
  settleIdle: (() => void) | null;
}

/** Waits before each retry of the latest snapshot when the tab is gone. */
export const UNMOUNTED_RETRY_MS = [1500, 4000] as const;

const queues = new Map<string, FormQueue>();

function queueOf(formId: string): FormQueue {
  let q = queues.get(formId);
  if (!q) {
    q = { seq: 0, inFlight: null, pending: null, subscribers: 0, retryTimer: null, idle: null, settleIdle: null };
    queues.set(formId, q);
  }
  return q;
}

/** Keep a promise registered with `connect-sync` while the queue has work, so a remount reads after it. */
function markBusy(formId: string, q: FormQueue): void {
  if (q.idle) return;
  q.idle = new Promise<void>((resolve) => (q.settleIdle = resolve));
  trackDestinationWrite(formId, q.idle);
}

function markIdleIfDone(q: FormQueue): void {
  if (q.inFlight || q.pending || q.retryTimer) return;
  const settle = q.settleIdle;
  q.idle = null;
  q.settleIdle = null;
  settle?.();
}

const failed = (r: unknown): r is { ok: false; transport?: boolean; message?: string } =>
  !!r && typeof r === 'object' && (r as { ok?: unknown }).ok === false;

/**
 * The editor is on screen for this form: while it is, its own autosave
 * controller retries a failed save, so the queue does not. Returns the
 * unsubscribe for unmount.
 */
export function subscribeIntegrationsSave(formId: string): () => void {
  const q = queueOf(formId);
  q.subscribers += 1;
  return () => {
    q.subscribers = Math.max(0, q.subscribers - 1);
  };
}

/** Whether the queue for a form has nothing in flight, waiting or scheduled. */
export function integrationsSaveIdle(formId: string): boolean {
  const q = queues.get(formId);
  return !q || (!q.inFlight && !q.pending && !q.retryTimer);
}

/**
 * Save this snapshot, after anything in flight, replacing anything older that
 * is still waiting. Resolves with this snapshot's first attempt, or with
 * `superseded` when a newer snapshot took its place.
 */
export function enqueueIntegrationsSave<R>(
  formId: string,
  send: () => Promise<R>,
  opts: { partial?: string | null; messages: { saveOffline: string; saveError: string; lost: string } },
): Promise<QueueOutcome<R>> {
  const q = queueOf(formId);
  markBusy(formId, q);
  publishIntegrationsSave(formId, { status: 'saving' });
  if (q.retryTimer) {
    // A newer snapshot supersedes the retry of an older one.
    clearTimeout(q.retryTimer);
    q.retryTimer = null;
  }
  return new Promise<QueueOutcome<R>>((resolve) => {
    const job: Job<R> = { seq: ++q.seq, send, partial: opts.partial ?? null, resolve };
    if (q.pending) q.pending.resolve({ kind: 'superseded' });
    q.pending = job as Job<unknown>;
    if (!q.inFlight) void drain(formId, q, opts.messages);
  });
}

async function drain(
  formId: string,
  q: FormQueue,
  messages: { saveOffline: string; saveError: string; lost: string },
  attempt = 0,
): Promise<void> {
  const job = q.pending;
  if (!job) {
    markIdleIfDone(q);
    return;
  }
  q.pending = null;
  q.inFlight = job;
  let result: unknown;
  try {
    result = await job.send();
  } catch (e) {
    result = { ok: false, transport: true, message: e instanceof Error ? e.message : 'save failed' };
  }
  q.inFlight = null;
  const isLatest = job.seq === q.seq;

  if (!isLatest) {
    // An older snapshot: whatever it came back with, the newer one decides.
    // Its failure is never retried and never reported.
    job.resolve(failed(result) ? { kind: 'superseded' } : { kind: 'sent', result });
    void drain(formId, q, messages);
    return;
  }

  if (!failed(result)) {
    publishIntegrationsSave(
      formId,
      job.partial ? { status: 'partial', detail: job.partial } : { status: 'saved' },
    );
    job.resolve({ kind: 'sent', result });
    markIdleIfDone(q);
    return;
  }

  // The latest snapshot failed.
  if (q.subscribers > 0) {
    // The editor is on screen: its controller decides about retrying.
    publishIntegrationsSave(
      formId,
      result.transport
        ? { status: 'retrying', detail: messages.saveOffline }
        : { status: 'error', detail: result.message ?? messages.saveError },
    );
    job.resolve({ kind: 'sent', result });
    markIdleIfDone(q);
    return;
  }
  const wait = UNMOUNTED_RETRY_MS[attempt];
  if (wait === undefined) {
    // Nobody to retry it and nothing left to try: say so, without a promise.
    publishIntegrationsSave(formId, { status: 'error', detail: messages.lost, lost: true });
    job.resolve({ kind: 'sent', result });
    markIdleIfDone(q);
    return;
  }
  // Retry THIS snapshot later, unless a newer one arrives first.
  if (attempt === 0) job.resolve({ kind: 'sent', result });
  q.retryTimer = setTimeout(() => {
    q.retryTimer = null;
    if (q.pending || q.inFlight) {
      markIdleIfDone(q);
      return;
    }
    q.pending = { ...job, resolve: () => {} };
    void drain(formId, q, messages, attempt + 1);
  }, wait);
}

/** Specs only: forget every queue. */
export function resetIntegrationsSaveQueues(): void {
  for (const q of queues.values()) if (q.retryTimer) clearTimeout(q.retryTimer);
  queues.clear();
}
