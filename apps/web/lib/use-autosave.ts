'use client';

/**
 * React binding for AutosaveController — the ONE autosave implementation the
 * admin editors share (builder + integrations). The controller owns the state
 * machine (debounce, serialization, generation-numbered dirtiness, retry with
 * backoff); this hook owns the browser wiring:
 *
 * - `visibilitychange` → flush through the server action while the component
 *   can still run one.
 * - `beforeunload` while dirty → (1) fire the caller's `beacon` (a keepalive
 *   POST to a same-origin flush route — it survives the tab closing), and
 *   (2) `preventDefault()` so the browser asks before discarding work. Both:
 *   the beacon is best-effort, the dialog is the guarantee.
 * - unmount (SPA nav) → flush through the server action.
 *
 * Callers provide snapshot/validate/save via a ref-read options object, so the
 * controller always sees the latest state and callbacks without re-subscribing.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AutosaveController,
  type AutosaveFailureKind,
  type AutosaveStatus,
  type SaveOutcome,
} from './autosave-controller';

export type { AutosaveFailureKind, AutosaveStatus } from './autosave-controller';

export interface UseAutosaveOptions<T> {
  getSnapshot: () => T;
  validate: (snapshot: T) => { ok: true } | { ok: false; reason: string };
  save: (snapshot: T) => Promise<SaveOutcome>;
  /** Keepalive path for a hard tab close — fired only for a VALID snapshot. */
  beacon?: (snapshot: T) => void;
  /** Crash-safety copy of the snapshot (localStorage), taken before saves and
   *  on the way out — even for a snapshot that fails validation. */
  backup?: { write: (snapshot: T) => void; clear: () => void };
  onFailure?: (message: string, kind: AutosaveFailureKind) => void;
  onSaved?: () => void;
  /** Start with unsaved changes (e.g. a config migrated on open). */
  initiallyDirty?: boolean;
  debounceMs?: number;
}

export interface Autosave {
  status: AutosaveStatus;
  /** Failure reason accompanying `error`/`retrying`, for tooltips/status lines. */
  detail: string | null;
  /** Call on every edit, after updating state. */
  markDirty: () => void;
  flush: () => void;
}

export function useAutosave<T>(options: UseAutosaveOptions<T>): Autosave {
  const [status, setStatus] = useState<AutosaveStatus>('saved');
  const [detail, setDetail] = useState<string | null>(null);

  // Latest options every controller callback reads through — one controller
  // instance per mounted life, zero stale closures.
  const optsRef = useRef(options);
  optsRef.current = options;

  const controllerRef = useRef<AutosaveController<T> | null>(null);
  const makeController = useCallback(
    () =>
      new AutosaveController<T>({
        getSnapshot: () => optsRef.current.getSnapshot(),
        validate: (s) => optsRef.current.validate(s),
        save: (s) => {
          optsRef.current.backup?.write(s);
          return optsRef.current.save(s);
        },
        onStatus: (next, d) => {
          setStatus(next);
          setDetail(d);
        },
        onFailure: (m, k) => optsRef.current.onFailure?.(m, k),
        onSaved: () => {
          optsRef.current.backup?.clear();
          optsRef.current.onSaved?.();
        },
        debounceMs: optsRef.current.debounceMs,
      }),
    [],
  );
  if (controllerRef.current === null) controllerRef.current = makeController();

  useEffect(() => {
    // Strict mode runs mount→cleanup→mount; the cleanup disposed the first
    // controller, so the second mount needs a live one.
    if (!controllerRef.current || controllerRef.current.isDisposed) {
      controllerRef.current = makeController();
    }
    const controller = controllerRef.current;
    if (optsRef.current.initiallyDirty && !controller.dirty) controller.markDirty();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden' && controller.dirty) {
        optsRef.current.backup?.write(optsRef.current.getSnapshot());
        controller.flush();
      }
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!controller.dirty) return;
      const snapshot = optsRef.current.getSnapshot();
      // Backup first — synchronous, survives even a cancelled dialog.
      optsRef.current.backup?.write(snapshot);
      if (optsRef.current.validate(snapshot).ok) optsRef.current.beacon?.(snapshot);
      // Ask before discarding: the beacon is fire-and-forget, not a guarantee.
      e.preventDefault();
      e.returnValue = '';
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('beforeunload', onBeforeUnload);
      // SPA nav / unmount: back up the LATEST snapshot (an in-flight save may
      // carry an older one), then dispose — which fires the terminal save.
      if (controller.dirty) optsRef.current.backup?.write(optsRef.current.getSnapshot());
      controller.dispose();
    };
    // Subscribe once per mounted life; all state flows through optsRef.
  }, []);

  const markDirty = useCallback(() => controllerRef.current?.markDirty(), []);
  const flush = useCallback(() => controllerRef.current?.flush(), []);
  return { status, detail, markDirty, flush };
}
