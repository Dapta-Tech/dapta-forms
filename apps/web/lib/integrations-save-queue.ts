'use client';

import { trackDestinationWrite } from './connect-sync';
import { publishIntegrationsSave, readIntegrationsSave } from './integrations-save-status';

/**
 * One write lane per form for everything that writes its destinations, owned
 * here and not by any component, so it behaves the same whether or not the
 * Connect tab is still on screen.
 *
 * TWO KINDS OF WORK
 *  - A SNAPSHOT is the Connect tab's whole destinations array
 *    (`enqueueIntegrationsSave`). Only the latest one matters: a newer
 *    snapshot replaces one still waiting, and an older one that fails is
 *    dropped, never retried.
 *  - An OUTSIDE WRITE reads what is stored, changes one thing and writes it
 *    back (`runDestinationWrite`): the Build tab's per-question HubSpot
 *    picker, a field-key rename, a spreadsheet attached after the tab was
 *    left. It is NOT a snapshot: it never replaces one and never cancels a
 *    retry. Treating a partial merge as a snapshot dropped the full save
 *    waiting behind it and reported "saved".
 *
 * ORDER
 *  One loop (`pump`) does all the writing, one write at a time:
 *    1. the waiting snapshot, if there is one;
 *    2. otherwise, if a failed snapshot is waiting for its retry, NOTHING:
 *       an outside write must land on top of the snapshot, not under it
 *       (the retry would write its older array over the outside change), so
 *       it waits out the retries, which are bounded (`UNMOUNTED_RETRY_MS`);
 *    3. otherwise the oldest outside write.
 *  Snapshots therefore always go before outside writes, and an outside write
 *  always reads a store that holds every snapshot that could still land.
 *
 * STATE (per form)                       WHO CHANGES IT
 *  running   the loop is active          `pump` only (set on entry, cleared in `finally`)
 *  waiting   the snapshot to send next   enqueue (set/replace), retry timer (set), `pump` (take)
 *  writing   the snapshot being sent     `write` only
 *  retry     a failed snapshot + timer   `write` (arm), its timer (fire), enqueue (cancel)
 *  outside   outside writes, in order    `runDestinationWrite` (push), `pump` (shift)
 *
 * LIVENESS: nothing ever waits on a promise another part of the queue has to
 * remember to resolve. The invariant is:
 *
 *    there is work  =>  the loop is running, OR a retry timer is armed.
 *
 *  - `enqueueIntegrationsSave` and `runDestinationWrite` add their work and
 *    call `pump` in the same synchronous step. If the loop is already running
 *    it will see the work: every `await` in the loop is followed by a fresh
 *    read of `waiting` / `retry` / `outside`.
 *  - The loop stops only when there is no waiting snapshot AND (a retry is
 *    armed OR there are no outside writes). Between that check and clearing
 *    `running` nothing is awaited, so no work can slip in unseen.
 *  - A retry timer, when it fires, moves its snapshot to `waiting` and calls
 *    `pump`. The only thing that cancels it is a newer snapshot, which sets
 *    `waiting` and calls `pump` itself.
 *  - The retry chain is finite: each attempt has an index into
 *    `UNMOUNTED_RETRY_MS`, and past its end the snapshot is reported lost.
 *
 * EVERY PROMISE SETTLES
 *  - A snapshot's: `superseded` when a newer one replaces it while it waits;
 *    otherwise in `write`, on each of its five exits (not the latest, landed,
 *    failed with the tab open, failed with retries left, failed for good).
 *  - An outside write's: resolved or rejected in `runOutside`, which the loop
 *    reaches as soon as no snapshot is waiting and no retry is armed.
 *  Two assumptions, both about what callers pass in. A `send` or an outside
 *  `write` settles: every caller passes a server action wrapped in
 *  `callAction` (or `callActionWithRetry`), which times out. And neither one
 *  awaits another call into this queue for the same form: it would be waiting
 *  for the lane it is occupying.
 *
 * WHAT IS REPORTED (topbar and save pill, through `integrations-save-status`)
 *  The latest snapshot's outcome only, so an older failure is never the
 *  current state. An outside write says nothing unless asked to (`report`):
 *  the picker has its own indicator, while a spreadsheet attached after the
 *  tab was left has no screen of its own to fail on.
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

type QueueMessages = { saveOffline: string; saveError: string; lost: string };

interface Snapshot {
  seq: number;
  send: () => Promise<unknown>;
  /** Shown instead of "saved" when the write lands (one card was left out). */
  partial: string | null;
  messages: QueueMessages;
  /** How many times it has been sent and failed with nobody on the tab. */
  attempt: number;
  resolve: (outcome: QueueOutcome<unknown>) => void;
}

interface OutsideWrite {
  run: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  /** Set when this write has to speak for itself in the topbar. */
  report: { lost: string } | null;
}

interface FormQueue {
  seq: number;
  subscribers: number;
  running: boolean;
  waiting: Snapshot | null;
  writing: Snapshot | null;
  retry: { snapshot: Snapshot; timer: ReturnType<typeof setTimeout> } | null;
  outside: OutsideWrite[];
  idle: Promise<void> | null;
  settleIdle: (() => void) | null;
}

/** Waits before each retry of the latest snapshot when the tab is gone. */
export const UNMOUNTED_RETRY_MS = [1500, 4000] as const;

const queues = new Map<string, FormQueue>();

function queueOf(formId: string): FormQueue {
  let q = queues.get(formId);
  if (!q) {
    q = {
      seq: 0,
      subscribers: 0,
      running: false,
      waiting: null,
      writing: null,
      retry: null,
      outside: [],
      idle: null,
      settleIdle: null,
    };
    queues.set(formId, q);
  }
  return q;
}

const hasWork = (q: FormQueue): boolean =>
  q.running || !!q.waiting || !!q.writing || !!q.retry || q.outside.length > 0;

/** Keep a promise registered with `connect-sync` while the queue has work, so a remount reads after it. */
function markBusy(formId: string, q: FormQueue): void {
  if (q.idle) return;
  q.idle = new Promise<void>((resolve) => (q.settleIdle = resolve));
  trackDestinationWrite(formId, q.idle);
}

function settleIfIdle(q: FormQueue): void {
  if (hasWork(q)) return;
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
  return !q || !hasWork(q);
}

/**
 * Save this snapshot, after anything being written, replacing anything older
 * that is still waiting (and the retry of an older one that failed). Resolves
 * with this snapshot's first attempt, or with `superseded` when a newer
 * snapshot took its place.
 *
 * Safe to call at any time, from anywhere, any number of times: it only sets
 * `waiting` and starts the loop if it is not running.
 */
export function enqueueIntegrationsSave<R>(
  formId: string,
  send: () => Promise<R>,
  opts: { partial?: string | null; messages: QueueMessages },
): Promise<QueueOutcome<R>> {
  const q = queueOf(formId);
  markBusy(formId, q);
  publishIntegrationsSave(formId, { status: 'saving' });
  if (q.retry) {
    // A newer snapshot supersedes the retry of an older one.
    clearTimeout(q.retry.timer);
    q.retry = null;
  }
  return new Promise<QueueOutcome<R>>((resolve) => {
    q.waiting?.resolve({ kind: 'superseded' });
    q.waiting = {
      seq: ++q.seq,
      send,
      partial: opts.partial ?? null,
      messages: opts.messages,
      attempt: 0,
      resolve: resolve as (outcome: QueueOutcome<unknown>) => void,
    };
    void pump(formId, q);
  });
}

/**
 * Run a destinations write that is not a snapshot, in line with the queue:
 * after every snapshot that is waiting, being written, or still has a retry
 * coming, and one at a time with other outside writes.
 *
 * Why it waits for the retries instead of going first: a failed snapshot is
 * the Connect tab's whole array as it was when the author left. Written after
 * this change, it would undo it. So it gets its full, bounded retry schedule;
 * if it lands, this write is applied on top of it, and if it never does it is
 * reported as lost (by the queue, as always) and this write goes ahead.
 *
 * Resolves or rejects with whatever `write` does. With `report`, the topbar
 * says "Saving" while it runs (unless it is already showing a failure) and a
 * result of `{ ok: false }` or a throw is reported as a lost change.
 *
 * Safe to call at any time and concurrently: calls run in the order made.
 */
export function runDestinationWrite<R>(
  formId: string,
  write: () => Promise<R>,
  opts: { report?: { lost: string } } = {},
): Promise<R> {
  const q = queueOf(formId);
  markBusy(formId, q);
  return new Promise<R>((resolve, reject) => {
    q.outside.push({ run: write, resolve: resolve as (value: unknown) => void, reject, report: opts.report ?? null });
    void pump(formId, q);
  });
}

/** The one loop that writes. See the file header for why it cannot stall. */
async function pump(formId: string, q: FormQueue): Promise<void> {
  if (q.running) return;
  q.running = true;
  try {
    for (;;) {
      const snapshot = q.waiting;
      if (snapshot) {
        q.waiting = null;
        await write(formId, q, snapshot);
        continue;
      }
      // A failed snapshot still has a retry coming: its timer restarts the
      // loop, and outside writes wait for it (see `runDestinationWrite`).
      if (q.retry) break;
      const next = q.outside.shift();
      if (!next) break;
      await runOutside(formId, q, next);
    }
  } finally {
    q.running = false;
    settleIfIdle(q);
  }
}

/** Send one snapshot and decide what its outcome means. Never throws. */
async function write(formId: string, q: FormQueue, snapshot: Snapshot): Promise<void> {
  q.writing = snapshot;
  let result: unknown;
  try {
    result = await snapshot.send();
  } catch (e) {
    result = { ok: false, transport: true, message: e instanceof Error ? e.message : 'save failed' };
  }
  q.writing = null;

  if (snapshot.seq !== q.seq) {
    // An older snapshot: whatever it came back with, the newer one decides.
    // Its failure is never retried and never reported.
    snapshot.resolve(failed(result) ? { kind: 'superseded' } : { kind: 'sent', result });
    return;
  }

  if (!failed(result)) {
    publishIntegrationsSave(
      formId,
      snapshot.partial ? { status: 'partial', detail: snapshot.partial } : { status: 'saved' },
    );
    snapshot.resolve({ kind: 'sent', result });
    return;
  }

  // The latest snapshot failed.
  const { messages } = snapshot;
  if (q.subscribers > 0) {
    // The editor is on screen: its controller decides about retrying.
    publishIntegrationsSave(
      formId,
      result.transport
        ? { status: 'retrying', detail: messages.saveOffline }
        : { status: 'error', detail: result.message ?? messages.saveError },
    );
    snapshot.resolve({ kind: 'sent', result });
    return;
  }
  const wait = UNMOUNTED_RETRY_MS[snapshot.attempt];
  if (wait === undefined) {
    // Nobody to retry it and nothing left to try: say so, without a promise.
    publishIntegrationsSave(formId, { status: 'error', detail: messages.lost, lost: true });
    snapshot.resolve({ kind: 'sent', result });
    return;
  }
  // Retry THIS snapshot later, unless a newer one arrives first. The caller
  // has its answer (the first attempt's); the retries are the queue's own.
  snapshot.resolve({ kind: 'sent', result });
  const again: Snapshot = { ...snapshot, attempt: snapshot.attempt + 1, resolve: () => {} };
  const timer = setTimeout(() => {
    if (q.retry?.snapshot !== again) return;
    q.retry = null;
    q.waiting = again;
    void pump(formId, q);
  }, wait);
  q.retry = { snapshot: again, timer };
}

/** Run one outside write and settle its promise. Never throws. */
async function runOutside(formId: string, q: FormQueue, task: OutsideWrite): Promise<void> {
  // It speaks in the topbar only when asked to, and only over "saved": a
  // failure already showing (the snapshot's) must not be painted over.
  const before = readIntegrationsSave(formId)?.status;
  const speaks = !!task.report && (before === undefined || before === 'saved');
  if (speaks) publishIntegrationsSave(formId, { status: 'saving' });
  const lost = () => {
    if (task.report) publishIntegrationsSave(formId, { status: 'error', detail: task.report.lost, lost: true });
  };
  try {
    const result = await task.run();
    if (failed(result)) lost();
    // "Saved" only when it is this write's own "Saving" that is showing and
    // no snapshot arrived meanwhile: a waiting snapshot publishes "Saving"
    // too, and its outcome is not known yet.
    else if (speaks && !q.waiting && readIntegrationsSave(formId)?.status === 'saving') {
      publishIntegrationsSave(formId, { status: 'saved' });
    }
    task.resolve(result);
  } catch (e) {
    lost();
    task.reject(e);
  }
}

/** Specs only: forget every queue. */
export function resetIntegrationsSaveQueues(): void {
  for (const q of queues.values()) if (q.retry) clearTimeout(q.retry.timer);
  queues.clear();
}
