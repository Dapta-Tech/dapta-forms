'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type {
  FormConfig,
  FormStep,
  FormCover,
  FormBranding,
  FormOutcome,
  FormEnding,
  FormLayout,
} from '@quill/engine';
import {
  normalizeConfig,
  renameStepKey as engineRenameStepKey,
  createEmptyStep,
  migrateRevealToStep,
  resolveFormLayout,
} from '@quill/engine';
import type { FormTracking } from '@quill/types';
import { formConfigSchema } from '@quill/types';
import { saveFormAction } from '@/app/admin/actions';
import { useToast } from '@/components/toast';
import { callAction, isTransportError } from '@/lib/call-action';
import { useAutosave } from '@/lib/use-autosave';
import { clearDraftBackup, readDraftBackup, writeDraftBackup } from '@/lib/draft-backup';
import { cn } from '@/lib/cn';
import { anchorRevealsLast } from './_components/logic-util';
import { QuestionSpine } from './_components/question-spine';
import { CanvasQuestion, CanvasPage } from './_components/canvas-question';
import { QuestionSettings } from './_components/question-settings';
import { invalidateQuestionHubspotCache } from './_components/question-hubspot';
import { renameQuestionMappingAction } from './_components/question-hubspot-actions';
import { TypeGallery } from './_components/type-gallery';
import { LogicMap } from './_components/logic-map';
import { LogicCanvas } from './_components/logic-canvas';
import { LogicDialog } from './_components/logic-dialog';
import { BranchingDialog } from './_components/branching-dialog';
import { ScoringDialog } from './_components/scoring-dialog';
import { OutcomesDialog } from './_components/outcomes-dialog';
import { useIsDesktop } from '@/lib/use-media-query';
import { EmptyState } from './_components/empty-state';
import { DesignPanel } from './_components/design-panel';
import { FlowPanel } from './_components/flow-panel';
import { EndingPanel } from './_components/ending-panel';
import { ConnectPanel } from './_components/connect-panel';
import { PublishButton } from './publish-button';
import { LinkActions } from './link-actions';
import { DevicePreviewModal } from './_components/device-preview-modal';
import {
  DeviceToggle,
  EditorToolbar,
  ToolbarButton,
  ToolbarIconButton,
  ToolbarSeparator,
  type Tab,
} from './_components/editor-toolbar';
import { stepFromGalleryItem, stepListLabel, type GalleryItem } from './_components/question-types';
import { TEMPLATES } from './_components/templates';
import { getBuilderMessages, tb, type TemplateId } from './_components/builder-messages';
import type { EditorMessages } from './_components/messages';
import './_components/builder.css';

const AUTOSAVE_MS = 900;

/** What one autosave write carries — always read fresh via `latest`. */
interface EditorSnapshot {
  name: string;
  config: FormConfig;
}

// `results` is deliberately NOT in this list: `parseTab('results')` falls
// through to Build, so a bookmark or an old link lands somewhere real instead
// of dead-ending. Its two panels live behind Logic → Scoring and Logic → Outcomes.
const TAB_IDS: readonly Tab[] = ['build', 'logic', 'connect', 'design'];
/** Unknown/absent `?tab` → build (the default view). */
const parseTab = (value: string | null): Tab =>
  TAB_IDS.includes(value as Tab) ? (value as Tab) : 'build';

/**
 * Re-anchor a 1-based flow marker position (`partialSubmitAfterStep`) after a
 * step is DELETED, keeping it attached to the step it
 * sits AFTER: a delete ABOVE the anchor shifts it up one; deleting the anchor
 * itself re-attaches to the previous step (clearing when it was the first);
 * deletes BELOW never move it. Absent/out-of-range positions pass through.
 */
function reanchorAfterDelete(
  pos: number | undefined,
  deletedIndex: number,
  prevLen: number,
): number | undefined {
  if (pos == null || pos < 1 || pos > prevLen) return pos;
  if (deletedIndex < pos - 1) return pos - 1;
  if (deletedIndex === pos - 1) return pos > 1 ? pos - 1 : undefined;
  return pos;
}

/**
 * Re-anchor a 1-based flow marker position after a REORDER: resolve the step it
 * was anchored after in the OLD order, then point at that step's NEW index so
 * the marker follows its anchor question. Absent/out-of-range positions pass
 * through unchanged.
 */
function reanchorAfterReorder(
  pos: number | undefined,
  oldSteps: FormStep[],
  newSteps: FormStep[],
): number | undefined {
  if (pos == null || pos < 1 || pos > oldSteps.length) return pos;
  const anchorKey = oldSteps[pos - 1]?.key;
  const anchored = newSteps.findIndex((s) => s.key === anchorKey);
  return anchored >= 0 ? anchored + 1 : pos;
}

/**
 * The redesigned builder shell: Build (spine · WYSIWYG canvas · settings),
 * Logic (editable map), Results (scoring + ranges), Design (cover + branding),
 * with debounced autosave and a Publish primary action. The guided empty state
 * (templates + scratch) shows until the form has questions.
 */
export function FormEditor({
  id,
  initialName,
  initialConfig,
  publicPath: initialPublicPath,
  locale,
  m,
  initialHasDraft = false,
  updatedAt,
}: {
  id: string;
  initialName: string;
  initialConfig: FormConfig;
  publicPath: string;
  locale: string;
  m: EditorMessages;
  /** Whether the form already had an unpublished draft when the page loaded. */
  initialHasDraft?: boolean;
  /** Server row's last-write stamp — gates the crash-recovery offer. */
  updatedAt?: number;
}) {
  const bm = getBuilderMessages(locale);
  const searchParams = useSearchParams();
  const [name, setName] = useState(initialName);
  /**
   * The form's public path, as STATE rather than the prop it arrives as.
   *
   * The slug in it is editable now (see `LinkActions`), and everything the
   * builder derives from this path is a client component holding it in props:
   * the topbar's Copy link / Embed / Open form, the design panel's preview, the
   * prefill example URL in question settings. A server `revalidatePath` cannot
   * reach any of them mid-session, so a rename would leave all four pointing at
   * a URL that now only 308-redirects, starting with the Copy button the person
   * is most likely to press next.
   */
  const [publicPath, setPublicPath] = useState(initialPublicPath);
  // The builder has ONE reveal model: a `reveal` step in the list. A form
  // authored under the old form-level reveal (Design-tab copy + a draggable
  // position marker) is folded into that shape the moment it opens, so the two
  // ways to author one screen never coexist on screen.
  const [config, setConfig] = useState<FormConfig>(() => {
    const migrated = migrateRevealToStep(initialConfig);
    // Vertical: a reveal card mid-list promises an interstitial the one-page
    // form never plays there — fold it to the end on open, same idiom as the
    // reveal migration above (identity-preserving when nothing moves, so an
    // already-anchored form does not start dirty).
    if (resolveFormLayout(migrated) !== 'vertical') return migrated;
    const anchored = anchorRevealsLast(migrated.steps);
    return anchored === migrated.steps ? migrated : { ...migrated, steps: anchored };
  });
  // Deep-linkable tabs: `?tab=connect` selects the tab on load…
  const [tab, setTabState] = useState<Tab>(() => parseTab(searchParams.get('tab')));
  // …and switching syncs the URL shallowly (no navigation, no RSC refetch).

  const setTab = useCallback(
    (next: Tab) => {
      // Mappings can change inside Connect — drop the Build settings panel's
      // cached HubSpot data so it refetches fresh on the next Build activation.
      if (next === 'connect') invalidateQuestionHubspotCache(id);
      setTabState(next);
      const url = new URL(window.location.href);
      if (next === 'build') url.searchParams.delete('tab');
      else url.searchParams.set('tab', next);
      window.history.replaceState(null, '', url);
    },
    [id],
  );
  const [selected, setSelected] = useState<number | null>(initialConfig.steps.length ? 0 : null);
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  /** Which step's logic dialog the Logic canvas has open, if any. */
  const [logicStep, setLogicStep] = useState<number | null>(null);
  /** Which FORM-WIDE logic dialog the Logic toolbar has open, if any. */
  const [logicView, setLogicView] = useState<'branching' | 'scoring' | 'outcomes' | null>(null);
  const isDesktop = useIsDesktop();
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [focusCanvas, setFocusCanvas] = useState(0);
  const [saveCount, setSaveCount] = useState(0);
  // Freshest name/config for save/flush/backup paths (no stale closures).
  const latest = useRef<EditorSnapshot>({ name, config });
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  useEffect(() => {
    latest.current = { name, config };
  }, [name, config]);

  // --- Autosave (each successful save stores an unpublished draft) -----------
  // The debounce/serialize/retry machinery lives in `useAutosave` (shared with
  // the integrations editor). What this component owes it: the freshest
  // snapshot, the zod pre-validation gate, the server write (transport-safe via
  // `callAction` — a rejected invocation is a retryable value, never a stuck
  // "Saving…"), the same-origin keepalive flush for hard tab closes, and a
  // localStorage backup so even a lost tab can offer its work back on reopen.
  const autosave = useAutosave<EditorSnapshot>({
    getSnapshot: () => latest.current,
    validate: useCallback((s: EditorSnapshot) => {
      const parsed = formConfigSchema.safeParse(normalizeConfig(s.config));
      if (parsed.success) return { ok: true as const };
      const issue = parsed.error.issues[0];
      const field = issue?.path.join('.') || 'config';
      return {
        ok: false as const,
        reason: `${field}: ${issue?.message ?? 'invalid value'}`,
      };
    }, []),
    save: (s) =>
      callAction(() => saveFormAction(id, { name: s.name, config: normalizeConfig(s.config) })),
    beacon: (s) => {
      try {
        void fetch(`/admin/forms/${id}/flush`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            kind: 'config',
            name: s.name,
            config: normalizeConfig(s.config),
          }),
          keepalive: true,
        });
      } catch {
        /* best-effort on the unload path — the localStorage backup remains */
      }
    },
    backup: {
      write: (s) => writeDraftBackup(id, s.name, s.config),
      clear: () => clearDraftBackup(id),
    },
    onFailure: (message, transport) => {
      console.error('[forms] autosave failed:', message);
      toastRef.current.error(
        transport ? m.saveOffline : tb(m.saveErrorReason, { reason: message }),
      );
    },
    onSaved: () => setSaveCount((n) => n + 1),
    // `migrateRevealToStep` returns the SAME object when there was nothing
    // legacy to fold in, so an identity check is an exact "did we migrate?" —
    // start dirty in that case and the first autosave persists the new shape.
    initiallyDirty: config !== initialConfig,
    debounceMs: AUTOSAVE_MS,
  });
  const status = autosave.status;

  // --- Crash recovery: work the backup caught that never reached the server --
  const [recovery, setRecovery] = useState<EditorSnapshot | null>(null);
  useEffect(() => {
    const b = readDraftBackup(id);
    if (!b) return;
    // Only offer a backup that is NEWER than the server row, parses, and
    // actually differs from what the server already has — else drop it quietly.
    const stale = updatedAt != null && b.ts <= updatedAt;
    const unchanged =
      b.name === initialName && JSON.stringify(b.config) === JSON.stringify(initialConfig);
    if (stale || unchanged || !formConfigSchema.safeParse(b.config).success) {
      clearDraftBackup(id);
      return;
    }
    // Restore the RAW stored config (not the zod output): parsing only gates
    // validity — stripping unknown-but-additive keys here would lose data.
    setRecovery({ name: b.name, config: b.config as FormConfig });
    // Mount-only: the backup verdict is about the page load, not later edits.
  }, []);
  function restoreRecovery() {
    if (!recovery) return;
    setName(recovery.name);
    setConfig(recovery.config);
    setSelected(recovery.config.steps.length ? 0 : null);
    setRecovery(null);
    autosave.markDirty(); // the restored work goes straight into the save loop
  }
  function discardRecovery() {
    clearDraftBackup(id);
    setRecovery(null);
  }

  function mutate(updater: (c: FormConfig) => FormConfig) {
    setConfig(updater);
    // A fresh edit outdates the crash backup — restoring it now would clobber
    // what was just typed, so the offer leaves with the first real edit.
    setRecovery(null);
    autosave.markDirty();
  }
  function rename(next: string) {
    setName(next);
    setRecovery(null);
    autosave.markDirty();
  }

  // --- Step operations ------------------------------------------------------
  function patchStep(index: number, patch: Partial<FormStep>) {
    mutate((c) => ({
      ...c,
      steps: c.steps.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    }));
  }
  /**
   * Rename a step's answer key (V5-A10). The engine's `renameStepKey` moves every
   * in-config pointer (conditions, goto targets, variant sources, override rules,
   * `[key]` tokens). HubSpot field mappings are stored OUTSIDE this config and
   * written through their own endpoint, so they are migrated separately — without
   * that second call a rename would silently unmap the question from the CRM.
   */
  function renameStepKey(index: number, nextKey: string) {
    const current = config.steps[index];
    if (!current) return;
    const oldKey = current.key;
    mutate((c) => engineRenameStepKey(c, oldKey, nextKey));
    void callAction(() => renameQuestionMappingAction(id, oldKey, nextKey)).then((res) => {
      if (isTransportError(res) || (!res.ok && res.code === 'error')) {
        // The config rename already applied and autosaved; only the CRM mapping
        // is behind. Say so rather than implying the whole rename failed.
        toastRef.current.error(m.behavior.fieldKeyMappingFailed);
      }
    });
  }
  function addFromGallery(item: GalleryItem) {
    mutate((c) => {
      const step = stepFromGalleryItem(item, new Set(c.steps.map((s) => s.key)));
      // Vertical: reveals are anchored last, so a new QUESTION lands before
      // them — appending blindly would file it after the end-reveal, i.e.
      // "after the results screen", a position that does not exist.
      const appended = [...c.steps, step];
      const steps = resolveFormLayout(c) === 'vertical' ? anchorRevealsLast(appended) : appended;
      setSelected(steps.findIndex((s) => s.key === step.key));
      return {
        ...c,
        steps,
        partialSubmitAfterStep: reanchorAfterReorder(c.partialSubmitAfterStep, appended, steps),
      };
    });
    setGalleryOpen(false);
    setTab('build');
    setFocusCanvas((n) => n + 1);
  }
  function deleteStep(index: number) {
    mutate((c) => {
      const steps = c.steps.filter((_, i) => i !== index);
      // Keep the partial-submit marker anchored to the step it fires AFTER.
      return {
        ...c,
        steps,
        partialSubmitAfterStep: reanchorAfterDelete(
          c.partialSubmitAfterStep,
          index,
          c.steps.length,
        ),
      };
    });
    setSelected((sel) => {
      const nextLen = config.steps.length - 1;
      if (sel == null || nextLen === 0) return null;
      if (sel === index) return Math.max(0, index - 1);
      return sel > index ? sel - 1 : sel;
    });
  }
  function reorderSteps(from: number, to: number) {
    // Compute the final order OUTSIDE the updater so selection can follow the
    // selected step BY KEY — on vertical the anchor pass may move more than the
    // dragged card (a reveal dropped mid-list snaps back to the end).
    const before = config.steps;
    const arr = [...before];
    const [moved] = arr.splice(from, 1);
    if (!moved) return;
    arr.splice(to, 0, moved);
    const after = layout === 'vertical' ? anchorRevealsLast(arr) : arr;
    const selectedKey = selected != null ? before[selected]?.key : undefined;
    mutate((c) => ({
      ...c,
      steps: after,
      // Keep the partial-submit marker attached to the step it fires AFTER.
      partialSubmitAfterStep: reanchorAfterReorder(c.partialSubmitAfterStep, c.steps, after),
    }));
    if (selectedKey != null) {
      const next = after.findIndex((s) => s.key === selectedKey);
      setSelected(next >= 0 ? next : null);
    }
  }
  function applyTemplate(tid: TemplateId) {
    const cfg = TEMPLATES[tid];
    // Preserve a name the user already typed; only fall back to the template's
    // name when the field is still blank (V4-11 — templates swap config, not name).
    setName((n) => (n.trim() ? n : bm.empty.templates[tid].name));
    setConfig(cfg);
    setSelected(0);
    setTab('build');
    autosave.markDirty();
  }

  // Public title (V7): what the tab/OG/cover show. Empty clears back to `name`.
  const setTitle = (title: string) => mutate((c) => ({ ...c, title: title.trim() ? title : null }));
  const patchCover = (patch: Partial<FormCover>) =>
    mutate((c) => ({ ...c, cover: { ...c.cover, ...patch } }));
  const patchBranding = (patch: Partial<FormBranding>) =>
    mutate((c) => ({ ...c, branding: { ...c.branding, ...patch } }));
  const setScoring = (enabled: boolean) => mutate((c) => ({ ...c, scoring: { enabled } }));
  const setOutcomes = (outcomes: FormOutcome[]) => mutate((c) => ({ ...c, outcomes }));
  /**
   * The per-question "Show reveal screen after" switch. A reveal is a STEP now,
   * so this inserts (or removes) a real reveal card immediately after `index`
   * rather than moving a form-level marker — the switch and the question list
   * describe the same thing, and the new card is editable like any other.
   */
  function setRevealAfter(index: number, on: boolean) {
    mutate((c) => {
      const next = c.steps[index + 1];
      const isReveal = next?.type === 'reveal';
      if (on === isReveal) return c;
      const at = index + 1;
      if (on) {
        const step = createEmptyStep('reveal', new Set(c.steps.map((s) => s.key)));
        return {
          ...c,
          steps: [...c.steps.slice(0, at), step, ...c.steps.slice(at)],
          // A marker anchored BELOW the insertion point shifts down one.
          partialSubmitAfterStep:
            c.partialSubmitAfterStep != null && c.partialSubmitAfterStep > at
              ? c.partialSubmitAfterStep + 1
              : c.partialSubmitAfterStep,
        };
      }
      return {
        ...c,
        steps: c.steps.filter((_, i) => i !== at),
        partialSubmitAfterStep: reanchorAfterDelete(c.partialSubmitAfterStep, at, c.steps.length),
      };
    });
  }
  /** Form-level ending copy/redirect — the defaults score ranges override (V5-B1). */
  const patchEnding = (patch: Partial<FormEnding>) =>
    mutate((c) => ({ ...c, ending: { ...c.ending, ...patch } }));
  const setPartialSubmitAfterStep = (afterStep: number | undefined) =>
    mutate((c) => ({ ...c, partialSubmitAfterStep: afterStep }));
  // `tracking` is additive config the engine type omits; the autosave/publish
  // flow round-trips it (normalizeConfig passes unknown top-level keys through).
  const setTracking = (tracking: FormTracking | undefined) =>
    mutate((c) => ({ ...c, tracking }) as FormConfig);
  // Layout is switchable at any time: the config is identical either way, the
  // renderers just present it differently — nothing is lost by toggling.
  // 'slides' is stored as ABSENT so a slides form keeps the exact config shape
  // every pre-layout form has. Switching TO vertical folds any mid-list reveal
  // to the end, where that layout actually plays it.
  const setLayout = (next: FormLayout) =>
    mutate((c) => ({
      ...c,
      layout: next === 'slides' ? undefined : next,
      steps: next === 'vertical' ? anchorRevealsLast(c.steps) : c.steps,
      partialSubmitAfterStep:
        next === 'vertical'
          ? reanchorAfterReorder(c.partialSubmitAfterStep, c.steps, anchorRevealsLast(c.steps))
          : c.partialSubmitAfterStep,
    }));
  /**
   * The vertical layout's ONE reveal, controlled from Design: ON appends a
   * reveal card at the end (edit its copy by selecting it), OFF removes every
   * reveal card. Per-question "reveal after" switches don't exist on vertical —
   * position is meaningless when the reveal always plays after Submit.
   */
  const hasReveal = config.steps.some((s) => s.type === 'reveal');
  function setEndReveal(on: boolean) {
    const keepLen = config.steps.filter((s) => s.type !== 'reveal').length;
    mutate((c) => {
      const has = c.steps.some((s) => s.type === 'reveal');
      if (on === has) return c;
      if (on) {
        const step = createEmptyStep('reveal', new Set(c.steps.map((s) => s.key)));
        return { ...c, steps: [...c.steps, step] }; // appended last — the marker never shifts
      }
      const keep = c.steps.filter((s) => s.type !== 'reveal');
      // Re-anchor the partial marker by the key it pointed at (a reveal can't
      // be the anchor's own step — it captures no answer — but positions shift).
      const anchorKey =
        c.partialSubmitAfterStep != null ? c.steps[c.partialSubmitAfterStep - 1]?.key : undefined;
      const idx = anchorKey ? keep.findIndex((s) => s.key === anchorKey) : -1;
      return {
        ...c,
        steps: keep,
        partialSubmitAfterStep: idx >= 0 ? idx + 1 : undefined,
      };
    });
    // Removing cards can strand the selection past the end of the list.
    if (!on)
      setSelected((sel) => (sel == null ? sel : keepLen === 0 ? null : Math.min(sel, keepLen - 1)));
  }

  /**
   * Pin (or, with `null`, release) one Logic-canvas node's position.
   *
   * Purely presentational — the engine ignores `logicLayout` entirely — but it
   * lives on the config so an arrangement survives a reload and reaches a
   * teammate. An emptied map is dropped rather than stored as `{}`, which is
   * what "no manual positions" already means everywhere else.
   */
  function pinLogicNode(nodeId: string, pos: { x: number; y: number } | null) {
    mutate((c) => {
      const next = { ...(c.logicLayout ?? {}) };
      if (pos) next[nodeId] = pos;
      else delete next[nodeId];
      return { ...c, logicLayout: Object.keys(next).length ? next : undefined };
    });
  }
  /**
   * Drop every pinned position at once. This is the escape hatch that keeps
   * pinning from rotting: a node pinned before its step was reordered sits
   * where it no longer belongs, and without a one-click way back the canvas
   * would slowly become the stale picture it exists to replace.
   */
  function autoArrangeLogic() {
    mutate((c) => ({ ...c, logicLayout: undefined }));
  }

  const selectedStep = selected != null ? config.steps[selected] : undefined;
  const logicDialogStep = logicStep != null ? config.steps[logicStep] : undefined;
  const scoringEnabled = config.scoring?.enabled !== false;
  const hasQuestions = config.steps.length > 0;
  const layout = resolveFormLayout(config);

  // The GENERAL menu (Typeform's Content/Workflow/Connect row). Design is not
  // here: it is a sub-mode of Build, entered from the builder's own toolbar —
  // the tab still exists as a parseable value so `?tab=design` links resolve.
  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: 'build', label: bm.shell.tabBuild, icon: 'pi-th-large' },
    { id: 'logic', label: bm.shell.tabLogic, icon: 'pi-sitemap' },
    { id: 'connect', label: m.connect.tab, icon: 'pi-link' },
  ];

  const statusLabel =
    status === 'saving'
      ? bm.shell.saving
      : status === 'retrying'
        ? bm.shell.retrying
        : status === 'error'
          ? bm.shell.saveError
          : hasQuestions
            ? bm.shell.saved
            : bm.shell.draft;
  const statusDot =
    status === 'error'
      ? 'bg-destructive'
      : status === 'saving' || status === 'retrying'
        ? 'bg-muted-foreground'
        : 'bg-primary-edge';
  /** Kept for tests/tools reading `data-status`: an empty saved form is "draft". */
  const displayStatus = status === 'saved' && !hasQuestions ? 'draft' : status;

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-background">
      {/* Topbar, row 1 — everything true of the WHOLE form.
          A three-column grid rather than a flex row: the tabs sit in the middle
          cell, so they stay centred no matter how long the form's name is or how
          wide the actions get. The old flex row made the tabs the first thing to
          lose space, which is why their labels had retreated behind `2xl` and a
          duplicate tab bar existed below `lg`. Both are gone: with the
          section-scoped controls moved to row 2, the tabs can be labelled from
          `md` up at every width. */}
      <header className="grid h-14 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 border-b border-border px-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            href="/admin/forms"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <i aria-hidden className="pi pi-chevron-left" style={{ fontSize: 12 }} />
            <span className="hidden sm:inline">{bm.shell.back}</span>
          </Link>
          <input
            value={name}
            onChange={(e) => rename(e.target.value)}
            placeholder={bm.shell.formNamePlaceholder}
            aria-label={bm.shell.formNamePlaceholder}
            className="min-w-0 max-w-[28ch] flex-1 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-base font-semibold tracking-tight hover:border-border focus-visible:border-input focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <span
            className={cn(
              'hidden shrink-0 items-center gap-1.5 text-xs text-muted-foreground xl:inline-flex',
              (status === 'error' || status === 'retrying') && autosave.detail ? 'cursor-help' : '',
            )}
            data-testid="editor-save-status"
            data-status={displayStatus}
            // Native tooltip: hover the "Not saved" indicator to read WHY it failed.
            title={
              (status === 'error' || status === 'retrying') && autosave.detail
                ? tb(m.saveErrorReason, { reason: autosave.detail })
                : undefined
            }
          >
            <span className={cn('h-1.5 w-1.5 rounded-full', statusDot)} />
            {statusLabel}
          </span>
        </div>

        <nav
          className="flex items-center gap-0.5 justify-self-center rounded-lg border border-border bg-card p-0.5"
          aria-label="Sections"
        >
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              data-testid={`editor-tab-${t.id}`}
              onClick={() => setTab(t.id)}
              // Design is a Build sub-mode, so Build stays the current section
              // while it is open — exactly how Typeform keeps Content lit while
              // its Design panel is up.
              aria-current={tab === t.id || (t.id === 'build' && tab === 'design')}
              title={t.label}
              className={cn(
                'inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors',
                // Below `md` these chips are icon-only, which makes the selected
                // state the ONLY thing saying which section you are in — and a
                // bare `bg-muted` wash is 1.14:1 dark / 1.17:1 light against the
                // bar. The rim carries the 3:1; the wash keeps doing the
                // scanning. Same mark as every other segmented pill in the app.
                tab === t.id
                  ? 'bg-muted text-foreground shadow-[inset_0_0_0_1px_var(--primary-edge)]'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <i aria-hidden className={`pi ${t.icon}`} style={{ fontSize: 12 }} />
              <span className="sr-only md:not-sr-only">{t.label}</span>
            </button>
          ))}
        </nav>

        <div className="flex min-w-0 items-center justify-end gap-2">
          <LinkActions
            publicPath={publicPath}
            formId={id}
            formName={name}
            onRenamed={setPublicPath}
            labels={{
              copyLink: bm.shell.copyLink,
              copied: bm.shell.copied,
              openForm: bm.shell.openForm,
              embed: bm.shell.embed,
              embedTitle: bm.shell.embedTitle,
              embedIntro: bm.shell.embedIntro,
              embedCopy: bm.shell.embedCopy,
              embedCopied: bm.shell.embedCopied,
              renameLink: bm.shell.renameLink,
              renameTitle: bm.shell.renameTitle,
              renameIntro: bm.shell.renameIntro,
              renameLabel: bm.shell.renameLabel,
              renameSave: bm.shell.renameSave,
              renameSaving: bm.shell.renameSaving,
              renameCancel: bm.shell.renameCancel,
              renameTaken: bm.shell.renameTaken,
              renameInvalid: bm.shell.renameInvalid,
              renameFailed: bm.shell.renameFailed,
            }}
          />
          <PublishButton
            formId={id}
            initialHasDraft={initialHasDraft}
            saveCount={saveCount}
            locale={locale}
          />
        </div>
      </header>

      {/* Crash recovery: edits the local backup caught that never reached the
          server (closed tab mid-outage, hung API). Offered once per load. */}
      {recovery ? (
        <div
          data-testid="draft-recovery-banner"
          className="flex flex-wrap items-center gap-3 border-b border-border bg-muted px-3 py-2 text-sm sm:px-4"
        >
          <i
            aria-hidden
            className="pi pi-history shrink-0 text-muted-foreground"
            style={{ fontSize: 14 }}
          />
          <p className="min-w-0 flex-1">
            <span className="font-medium">{bm.shell.recoveryTitle}</span>{' '}
            <span className="text-muted-foreground">{bm.shell.recoveryBody}</span>
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={restoreRecovery}
              className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {bm.shell.recoveryRestore}
            </button>
            <button
              type="button"
              onClick={discardRecovery}
              className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {bm.shell.recoveryDiscard}
            </button>
          </div>
        </div>
      ) : null}

      {/* Topbar, row 2 — contextual: only what acts on the CURRENT section. */}
      <EditorToolbar m={bm}>
        {/* The builder's own submenu, Typeform-shaped: "+ Add content · Design ·
            device · preview" live INSIDE the builder, not in the general menu.
            Design renders on the design sub-mode too, lit, and toggles back. */}
        {tab === 'build' || tab === 'design' ? (
          <>
            <ToolbarButton
              icon="pi-plus"
              label={bm.shell.addQuestion}
              onClick={() => setGalleryOpen(true)}
              primary
              testId="toolbar-add-question"
            />
            <ToolbarSeparator />
            <ToolbarButton
              icon="pi-palette"
              label={bm.shell.tabDesign}
              active={tab === 'design'}
              onClick={() => setTab(tab === 'design' ? 'build' : 'design')}
              testId="editor-tab-design"
            />
            <ToolbarSeparator />
            {hasQuestions && tab === 'build' ? (
              <DeviceToggle device={device} onChange={setDevice} m={bm} />
            ) : null}
            {/* Preview rides WITH the viewport cluster instead of drifting to
                the far edge. The eye is the product's original preview glyph.
                `data-tour` anchors the first-run tour's Preview step: the
                control left the header row, so the anchor moves with it. */}
            <span className="flex shrink-0 items-center" data-tour="preview">
              <ToolbarIconButton
                icon="pi-eye"
                label={bm.shell.preview}
                onClick={() => setPreviewOpen(true)}
                testId="toolbar-preview"
              />
            </span>
          </>
        ) : null}
        {/* Logic's own menu. Each entry is a FORM-WIDE view of one axis — the
            builder can otherwise only ever show logic one question at a time,
            so there was nowhere to answer "what does this whole form do?". */}
        {tab === 'logic' ? (
          <>
            <ToolbarButton
              icon="pi-sitemap"
              label={bm.branching.open}
              onClick={() => setLogicView('branching')}
              testId="toolbar-branching"
            />
            <ToolbarButton
              icon="pi-star"
              label={bm.scoring.open}
              onClick={() => setLogicView('scoring')}
              testId="toolbar-scoring"
            />
            <ToolbarButton
              icon="pi-flag"
              label={bm.outcomes.open}
              onClick={() => setLogicView('outcomes')}
              testId="toolbar-outcomes"
            />
          </>
        ) : null}
        {/* On Logic and Connect the preview keeps a home at the row's end —
            "what does this look like now?" is true of every section. */}
        {tab === 'logic' || tab === 'connect' ? (
          <span className="ml-auto flex items-center gap-1.5">
            <ToolbarIconButton
              icon="pi-eye"
              label={bm.shell.preview}
              onClick={() => setPreviewOpen(true)}
              testId="toolbar-preview"
            />
          </span>
        ) : null}
      </EditorToolbar>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === 'build' ? (
          hasQuestions ? (
            // The settings panel widens with the viewport (V5-B6): it packs the
            // densest controls in the builder — an option row is drag handle +
            // label + value + points + delete — and at a fixed 360px those
            // fields were cramped on displays with room to spare. It only grows
            // past 360 at xl, so a 13" laptop keeps the canvas width it had.
            <div className="grid h-full grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)_360px] xl:grid-cols-[280px_minmax(0,1fr)_420px] 2xl:grid-cols-[300px_minmax(0,1fr)_460px]">
              {/* Left spine */}
              <aside className="hidden min-h-0 overflow-y-auto lg:block" data-tour="edit">
                <QuestionSpine
                  steps={config.steps}
                  selectedIndex={selected}
                  onSelect={setSelected}
                  onReorder={reorderSteps}
                  onAdd={() => setGalleryOpen(true)}
                  partialAfterStep={config.partialSubmitAfterStep}
                  onPartialChange={setPartialSubmitAfterStep}
                  m={bm}
                />
              </aside>

              {/* Center canvas */}
              <main className="flex min-h-0 flex-col overflow-y-auto">
                {/* The device switch used to live here, in a third chrome strip
                    directly under the topbar's two. It is a Build-scoped
                    control, so it moved into the contextual toolbar — one strip
                    instead of two, and the canvas gets the height back. What
                    stays is the caption, which describes the canvas itself. */}
                <div className="border-b border-border px-4 py-2.5 text-sm text-muted-foreground">
                  <span className="truncate">
                    {selected != null
                      ? `${tb(bm.shell.questionOfTotal, { n: selected + 1, total: config.steps.length })} · ${bm.shell.editingLive}`
                      : ''}
                  </span>
                </div>
                <div className="flex-1 px-4 py-6 sm:px-8">
                  {selectedStep && selected != null ? (
                    layout === 'vertical' ? (
                      // The one-page canvas IS the page: every question stacked
                      // and editable, one Submit — no remount on selection, so
                      // switching questions scrolls instead of swapping cards.
                      <CanvasPage
                        config={config}
                        selected={selected}
                        device={device}
                        focusSignal={focusCanvas}
                        onSelect={setSelected}
                        onUpdateStep={patchStep}
                        m={bm}
                      />
                    ) : (
                      <CanvasQuestion
                        key={`${selected}-${focusCanvas}`}
                        config={config}
                        step={selectedStep}
                        index={selected}
                        total={config.steps.length}
                        device={device}
                        onUpdate={(patch) => patchStep(selected, patch)}
                        m={bm}
                      />
                    )
                  ) : (
                    <p className="py-16 text-center text-sm text-muted-foreground">
                      {bm.settings.empty}
                    </p>
                  )}
                </div>
                {/* Mobile question strip */}
                <div className="flex gap-2 overflow-x-auto border-t border-border px-3 py-2 lg:hidden">
                  {config.steps.map((s, i) => (
                    <button
                      key={s.key}
                      type="button"
                      onClick={() => setSelected(i)}
                      className={cn(
                        'inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs',
                        i === selected
                          ? 'border-primary-edge bg-primary/10 text-foreground'
                          : 'border-border text-muted-foreground',
                      )}
                    >
                      <span className="font-bold tabular-nums">{i + 1}</span>
                      <span className="max-w-[9ch] truncate">{stepListLabel(s, bm)}</span>
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setGalleryOpen(true)}
                    aria-label={bm.shell.addQuestion}
                    className="inline-flex shrink-0 items-center justify-center rounded-lg border border-dashed border-border px-3 py-1.5 text-muted-foreground"
                  >
                    <i aria-hidden className="pi pi-plus" style={{ fontSize: 12 }} />
                  </button>
                </div>
              </main>

              {/* Right settings */}
              <aside className="min-h-0 overflow-y-auto border-t border-border lg:border-t-0">
                {selectedStep && selected != null ? (
                  <QuestionSettings
                    formId={id}
                    onOpenConnect={() => setTab('connect')}
                    publicUrl={publicPath}
                    step={selectedStep}
                    index={selected}
                    steps={config.steps}
                    layout={layout}
                    scoringEnabled={scoringEnabled}
                    onUpdate={(patch) => patchStep(selected, patch)}
                    onDelete={() => deleteStep(selected)}
                    bm={bm}
                    em={m}
                    locale={locale}
                    revealAfter={config.steps[selected + 1]?.type === 'reveal'}
                    onRevealAfterChange={(on) => setRevealAfter(selected, on)}
                    onRenameKey={(nextKey) => renameStepKey(selected, nextKey)}
                  />
                ) : null}
              </aside>
            </div>
          ) : (
            <div className="h-full overflow-y-auto">
              <EmptyState
                onPickTemplate={applyTemplate}
                onScratch={() => setGalleryOpen(true)}
                m={bm}
              />
            </div>
          )
        ) : tab === 'logic' ? (
          // The canvas needs a real viewport to lay itself out against and pans
          // with the pointer, neither of which a phone gives it — so below `lg`
          // the readable vertical list stays. Branching on a media QUERY rather
          // than a CSS class because these are different components: a hidden
          // canvas would measure a zero-width box on mount and fit to nothing.
          isDesktop ? (
            <LogicCanvas
              config={config}
              m={bm}
              onEditStep={setLogicStep}
              onEditOutcomes={() => setLogicView('outcomes')}
              onMoveStep={reorderSteps}
              onPinNode={pinLogicNode}
              onAutoArrange={autoArrangeLogic}
            />
          ) : (
            <div className="h-full overflow-y-auto px-4 py-6 sm:px-8">
              <p className="mb-4 text-sm text-muted-foreground">{bm.map.title}</p>
              <LogicMap config={config} m={bm} />
            </div>
          )
        ) : tab === 'connect' ? (
          <div className="h-full overflow-y-auto px-4 py-6 sm:px-8">
            <ConnectPanel
              formId={id}
              config={config}
              onTrackingChange={setTracking}
              m={m}
              locale={locale}
            />
          </div>
        ) : (
          <DesignPanel
            config={config}
            name={name}
            publicPath={publicPath}
            locale={locale}
            layout={layout}
            onTitleChange={setTitle}
            onLayoutChange={setLayout}
            hasReveal={hasReveal}
            onEndRevealChange={setEndReveal}
            onCoverChange={patchCover}
            onBrandingChange={patchBranding}
            m={m}
          >
            <FlowPanel partialNote={bm.partial.designNote} m={m} />
            <EndingPanel
              config={config}
              onEndingChange={patchEnding}
              hasOutcomes={(config.outcomes?.length ?? 0) > 0 && scoringEnabled}
              m={m}
            />
          </DesignPanel>
        )}
      </div>

      <TypeGallery
        open={galleryOpen}
        onClose={() => setGalleryOpen(false)}
        onPick={addFromGallery}
        m={bm}
        // Vertical: one reveal, always at the end — a second tile pick would
        // create a card the renderer ignores, so it's offered exactly once.
        disabled={
          layout === 'vertical' && hasReveal
            ? { reveal: bm.gallery.revealVerticalTaken }
            : undefined
        }
      />
      {/* The three form-wide views. Branching edits INLINE (R7) — same
          LogicRules/LogicConditions the per-question dialog hosts, same
          patchStep write path, so the two surfaces can never disagree. */}
      <BranchingDialog
        open={logicView === 'branching'}
        onClose={() => setLogicView(null)}
        steps={config.steps}
        scoringEnabled={scoringEnabled}
        onUpdateStep={patchStep}
        bm={bm}
        em={m}
      />
      <ScoringDialog
        open={logicView === 'scoring'}
        onClose={() => setLogicView(null)}
        config={config}
        onScoringChange={setScoring}
        onStepScoringChange={(index, on) =>
          patchStep(index, { scoringEnabled: on ? undefined : false })
        }
        onStepPatch={patchStep}
        bm={bm}
        em={m}
      />
      <OutcomesDialog
        open={logicView === 'outcomes'}
        onClose={() => setLogicView(null)}
        config={config}
        onOutcomesChange={setOutcomes}
        bm={bm}
        rm={m.resultsHelp}
      />
      {/* The canvas's nodes open the SAME per-question dialog the Build panel
          opens. It is mounted here rather than inside the canvas because the
          canvas has many nodes and only one dialog may exist at a time. */}
      {logicDialogStep && logicStep != null ? (
        <LogicDialog
          open
          onClose={() => setLogicStep(null)}
          step={logicDialogStep}
          index={logicStep}
          steps={config.steps}
          scoringEnabled={scoringEnabled}
          onUpdate={(patch) => patchStep(logicStep, patch)}
          bm={bm}
          em={m}
        />
      ) : null}
      <DevicePreviewModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        config={config}
        name={name}
        locale={locale}
        layout={layout}
        m={m.preview}
      />
    </div>
  );
}
