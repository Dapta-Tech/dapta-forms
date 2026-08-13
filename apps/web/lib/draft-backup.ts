/**
 * Crash-safety copy of the builder's unsaved work, in localStorage. Written on
 * the way out (beforeunload/tab-hide) and before each save attempt; cleared the
 * moment a save catches up with the latest edits. If every server path fails —
 * offline, mid-deploy, a hung API — the work survives the reload, and the
 * editor offers to restore it on the next open.
 *
 * All accessors swallow storage errors (private mode, quota): the backup is a
 * safety net UNDER autosave, never something that can break the editor.
 */

export interface DraftBackup {
  name: string;
  config: unknown;
  /** Epoch-ms of the backup write — compared against the form's `updatedAt`. */
  ts: number;
}

const key = (formId: string) => `quill:draft-backup:${formId}`;

export function writeDraftBackup(formId: string, name: string, config: unknown): void {
  try {
    localStorage.setItem(key(formId), JSON.stringify({ name, config, ts: Date.now() }));
  } catch {
    /* storage unavailable/full — autosave still owns durability */
  }
}

export function readDraftBackup(formId: string): DraftBackup | null {
  try {
    const raw = localStorage.getItem(key(formId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DraftBackup;
    if (typeof parsed !== 'object' || parsed === null || typeof parsed.ts !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearDraftBackup(formId: string): void {
  try {
    localStorage.removeItem(key(formId));
  } catch {
    /* nothing to do */
  }
}
