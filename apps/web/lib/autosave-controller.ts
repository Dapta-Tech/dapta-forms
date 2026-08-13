/**
 * The autosave state machine, framework-free so it can be unit-tested in node.
 * `useAutosave` (use-autosave.ts) is the thin React binding; the builder and the
 * integrations editor both run on this controller instead of hand-rolled copies
 * of the same debounce/flush logic — the two copies had already drifted, and
 * both shared the bugs this class exists to kill:
 *
 * - A save whose INVOCATION failed (transport) left the status on "saving"
 *   forever with no retry. Here every failure moves to `retrying`/`error` and
 *   schedules a bounded-backoff re-attempt that only a successful save stops.
 * - Overlapping saves raced: an old save resolving late could clear the dirty
 *   flag over newer edits (losing them on nav) or stamp a stale status. Here
 *   saves are serialized and dirtiness is a GENERATION NUMBER — a save only
 *   counts as "caught up" if nothing was edited while it was in flight.
 */

import { isTransportError, type TransportError } from './call-action';

export type AutosaveStatus = 'saved' | 'saving' | 'retrying' | 'error';

export type AutosaveFailureKind = 'invalid' | 'server' | 'transport';

/** What a save attempt produced, as the controller sees it. `ok` is a plain
 *  boolean (not a discriminant) because server actions type it that way. */
export type SaveOutcome = { ok: boolean; message?: string } | TransportError;

export interface AutosaveOptions<T> {
  /** Latest data to persist. Called at save time — never a stale closure. */
  getSnapshot: () => T;
  /** Client-side gate: an invalid snapshot is never sent (status → error). */
  validate: (snapshot: T) => { ok: true } | { ok: false; reason: string };
  /** The server write, already transport-safe (wrap the action in callAction). */
  save: (snapshot: T) => Promise<SaveOutcome>;
  /** Status changes for the UI. `detail` carries the failure reason, if any. */
  onStatus: (status: AutosaveStatus, detail: string | null) => void;
  /**
   * First failure after a healthy stretch — the "toast once" hook. Retries of
   * the same outage stay quiet; a later recovery re-arms it. `kind` picks the
   * copy: `invalid` (client validation), `server` (the API said no), or
   * `transport` (never reached the server; quietly retrying).
   */
  onFailure?: (message: string, kind: AutosaveFailureKind) => void;
  /** Fired on every save that left the server holding the LATEST edits. */
  onSaved?: () => void;
  debounceMs?: number;
  /** First retry delay; doubles per consecutive failure up to `maxBackoffMs`. */
  initialBackoffMs?: number;
  maxBackoffMs?: number;
}

const DEFAULT_DEBOUNCE_MS = 900;
const DEFAULT_INITIAL_BACKOFF_MS = 1_500;
const DEFAULT_MAX_BACKOFF_MS = 30_000;

export class AutosaveController<T> {
  /** Bumped on every edit; the save that persists generation N clears N only. */
  private generation = 0;
  private savedGeneration = 0;
  private inFlight = false;
  private disposed = false;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private backoffMs: number;
  private failureNotified = false;

  constructor(private readonly opts: AutosaveOptions<T>) {
    this.backoffMs = opts.initialBackoffMs ?? DEFAULT_INITIAL_BACKOFF_MS;
  }

  get dirty(): boolean {
    return this.generation !== this.savedGeneration;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  /** An edit happened. Debounces a save; shows "saving" immediately. */
  markDirty(): void {
    if (this.disposed) return;
    this.generation++;
    // A fresh edit supersedes any scheduled retry — the debounce path owns it.
    this.clearRetry();
    this.opts.onStatus('saving', null);
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.run();
    }, this.opts.debounceMs ?? DEFAULT_DEBOUNCE_MS);
  }

  /** Save now if there are unsaved edits (nav-away, tab hidden, unmount). */
  flush(): void {
    if (this.disposed || !this.dirty) return;
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.clearRetry();
    void this.run();
  }

  /**
   * Stop timers and fire one TERMINAL save if edits are still unsaved.
   *
   * The terminal attempt is unconditional on `inFlight` — that is the point.
   * `flush()` no-ops while a save is in flight, so "gen-1 save in flight, user
   * edits gen-2, user navigates away" would otherwise lose gen-2 forever: the
   * in-flight save resolves after disposal and its dirty-recheck never runs.
   * Server actions from one client run serially, so this write queues behind
   * any in-flight save and lands carrying the LATEST snapshot (last write
   * wins). In-flight saves otherwise settle harmlessly (status not touched).
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.clearRetry();
    if (!this.dirty) return;
    const snapshot = this.opts.getSnapshot();
    if (!this.opts.validate(snapshot).ok) return; // backup (hook cleanup) still holds it
    void Promise.resolve()
      .then(() => this.opts.save(snapshot))
      .catch(() => {
        /* fire-and-forget: past disposal there is no state left to update */
      });
  }

  private clearRetry(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private scheduleRetry(): void {
    if (this.disposed || this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.run();
    }, this.backoffMs);
    this.backoffMs = Math.min(this.backoffMs * 2, this.opts.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS);
  }

  private async run(): Promise<void> {
    if (this.disposed || this.inFlight || !this.dirty) return;

    const snapshot = this.opts.getSnapshot();
    const valid = this.opts.validate(snapshot);
    if (!valid.ok) {
      // Never retried: only the next edit can fix an invalid config.
      this.opts.onStatus('error', valid.reason);
      if (!this.failureNotified) {
        this.failureNotified = true;
        this.opts.onFailure?.(valid.reason, 'invalid');
      }
      return;
    }

    const attempted = this.generation;
    this.inFlight = true;
    this.opts.onStatus('saving', null);
    let outcome: SaveOutcome;
    try {
      outcome = await this.opts.save(snapshot);
    } catch (e) {
      // Belt and braces — `save` should already be transport-safe via callAction.
      outcome = { ok: false, transport: true, message: e instanceof Error ? e.message : 'save failed' };
    }
    this.inFlight = false;
    if (this.disposed) return;

    if (outcome.ok) {
      this.savedGeneration = attempted;
      this.backoffMs = this.opts.initialBackoffMs ?? DEFAULT_INITIAL_BACKOFF_MS;
      this.failureNotified = false;
      if (this.dirty) {
        // Edited while the save was in flight — the server holds a stale
        // snapshot. Keep "saving" on screen and go again immediately (the
        // debounce already elapsed; there is no user pause left to wait for).
        this.opts.onStatus('saving', null);
        void this.run();
      } else {
        this.opts.onStatus('saved', null);
        this.opts.onSaved?.();
      }
      return;
    }

    const transport = isTransportError(outcome);
    const message = outcome.message ?? 'save failed';
    // Transport = "never reached the server", quietly self-healing → retrying.
    // A server rejection is worth the louder ERROR state, but it is retried
    // too: 500s and restarts are as transient as a dropped connection.
    this.opts.onStatus(transport ? 'retrying' : 'error', message);
    if (!this.failureNotified) {
      this.failureNotified = true;
      this.opts.onFailure?.(message, transport ? 'transport' : 'server');
    }
    this.scheduleRetry();
  }
}
