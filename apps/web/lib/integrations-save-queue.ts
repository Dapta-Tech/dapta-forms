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
  /** The failed snapshot `retryTimer` is waiting to write again. */
  retry: { job: Job<unknown>; attempt: number; messages: QueueMessages } | null;
  /** A write from outside the queue that is running now: saves wait for it. */
  foreign: Promise<void> | null;
  /** Resolved whenever nothing is in flight (a snapshot may be waiting, a retry scheduled). */
  quiet: (() => void)[];
  idle: Promise<void> | null;
  settleIdle: (() => void) | null;
}

type QueueMessages = { saveOffline: string; saveError: string; lost: string };

/** Waits before each retry of the latest snapshot when the tab is gone. */
export const UNMOUNTED_RETRY_MS = [1500, 4000] as const;

const queues = new Map<string, FormQueue>();

function queueOf(formId: string): FormQueue {
  let q = queues.get(formId);
  if (!q) {
    q = {
      seq: 0,
      inFlight: null,
      pending: null,
      subscribers: 0,
      retryTimer: null,
      retry: null,
      foreign: null,
      quiet: [],
      idle: null,
      settleIdle: null,
    };
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
  if (!q.inFlight) {
    const waiting = q.quiet;
    q.quiet = [];
    for (const resolve of waiting) resolve();
  }
  if (q.inFlight || q.pending || q.retryTimer || q.foreign) return;
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
  return !q || (!q.inFlight && !q.pending && !q.retryTimer && !q.foreign);
}

/**
 * Save this snapshot, after anything in flight, replacing anything older that
 * is still waiting. Resolves with this snapshot's first attempt, or with
 * `superseded` when a newer snapshot took its place.
 */
export function enqueueIntegrationsSave<R>(
  formId: string,
  send: () => Promise<R>,
  opts: { partial?: string | null; messages: QueueMessages },
): Promise<QueueOutcome<R>> {
  const q = queueOf(formId);
  markBusy(formId, q);
  publishIntegrationsSave(formId, { status: 'saving' });
  if (q.retryTimer) {
    // A newer snapshot supersedes the retry of an older one.
    clearTimeout(q.retryTimer);
    q.retryTimer = null;
    q.retry = null;
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
  messages: QueueMessages,
  attempt = 0,
  /** The retry an outside write runs before itself: it must not wait for that write. */
  ahead = false,
): Promise<void> {
  // A write from outside the queue goes first: this one must not land in the
  // middle of its read-modify-write. Whoever is still waiting when it ends
  // re-reads the queue below, so two drains that both waited cannot both send.
  while (q.foreign && !ahead) await q.foreign;
  if (q.inFlight) return;
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
  q.retry = { job, attempt: attempt + 1, messages };
  q.retryTimer = setTimeout(() => runRetry(formId, q), wait);
  markIdleIfDone(q);
}

/** Write the failed snapshot again: when its timer fires, or early (see `runDestinationWrite`). */
function runRetry(formId: string, q: FormQueue, ahead = false): void {
  const retry = q.retry;
  if (q.retryTimer) clearTimeout(q.retryTimer);
  q.retryTimer = null;
  q.retry = null;
  if (!retry || q.pending || q.inFlight) {
    markIdleIfDone(q);
    return;
  }
  q.pending = { ...retry.job, resolve: () => {} };
  void drain(formId, q, retry.messages, retry.attempt, ahead);
}

/**
 * Resolves once nothing is being written. A snapshot still WAITING does not
 * count: with an outside write open it is parked behind that write, and
 * waiting for it here would be waiting for ourselves.
 */
function whenQuiet(q: FormQueue): Promise<void> {
  if (!q.inFlight) return Promise.resolve();
  return new Promise<void>((resolve) => q.quiet.push(resolve));
}

/**
 * Run a destinations write that does not go through the queue's snapshots
 * (the Build tab's per-question HubSpot picker, a field-key rename, a card
 * action that finished after the tab was left), in line with it.
 *
 * Those writes read the stored destinations, change one thing and write the
 * array back. Next to the queue that is a race in both directions: a failed
 * snapshot waiting for its retry would be written over the new mapping a few
 * seconds later, undoing it, and a snapshot in flight could land between the
 * other write's read and its write. So:
 *  - it waits for whatever the queue is writing;
 *  - a failed snapshot waiting for its retry gets that try NOW, first, so the
 *    write that follows reads it if it lands;
 *  - if it still has not landed, its retry is dropped, since writing that
 *    older array later would undo this write, and the change it carried is
 *    reported as lost (it never reached the server);
 *  - queue saves that arrive meanwhile wait for this write to finish.
 */
export async function runDestinationWrite<R>(formId: string, write: () => Promise<R>): Promise<R> {
  const q = queueOf(formId);
  // One at a time among themselves too.
  while (q.foreign) await q.foreign;
  let release!: () => void;
  q.foreign = new Promise<void>((resolve) => (release = resolve));
  markBusy(formId, q);
  try {
    await whenQuiet(q);
    if (q.retry) {
      runRetry(formId, q, true);
      await whenQuiet(q);
    }
    if (q.retry) {
      const { messages } = q.retry;
      if (q.retryTimer) clearTimeout(q.retryTimer);
      q.retryTimer = null;
      q.retry = null;
      publishIntegrationsSave(formId, { status: 'error', detail: messages.lost, lost: true });
    }
    return await write();
  } finally {
    q.foreign = null;
    // A save that arrived meanwhile is parked in its own `drain`, waiting on
    // this promise: releasing it is what sends it.
    release();
    markIdleIfDone(q);
  }
}

/** Specs only: forget every queue. */
export function resetIntegrationsSaveQueues(): void {
  for (const q of queues.values()) if (q.retryTimer) clearTimeout(q.retryTimer);
  queues.clear();
}
