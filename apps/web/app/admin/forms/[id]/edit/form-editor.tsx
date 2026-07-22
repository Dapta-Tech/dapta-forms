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
  FormReveal,
  FormEnding,
} from '@quill/engine';
import { normalizeConfig, renameStepKey as engineRenameStepKey } from '@quill/engine';
import type { FormTracking } from '@quill/types';
import { formConfigSchema } from '@quill/types';
import { saveFormAction } from '@/app/admin/actions';
import { useToast } from '@/components/toast';
import { cn } from '@/lib/cn';
import { QuestionSpine } from './_components/question-spine';
import { CanvasQuestion } from './_components/canvas-question';
import { QuestionSettings } from './_components/question-settings';
import { invalidateQuestionHubspotCache } from './_components/question-hubspot';
import { renameQuestionMappingAction } from './_components/question-hubspot-actions';
import { TypeGallery } from './_components/type-gallery';
import { LogicMap } from './_components/logic-map';
import { ResultsView } from './_components/results-view';
import { EmptyState } from './_components/empty-state';
import { CoverPanel } from './_components/cover-panel';
import { RevealPanel } from './_components/reveal-panel';
import { EndingPanel } from './_components/ending-panel';
import { ConnectPanel } from './_components/connect-panel';
import { PublishButton } from './publish-button';
import { LinkActions } from './link-actions';
import { DevicePreviewModal } from './_components/device-preview-modal';
import { stepFromGalleryItem, type GalleryItem } from './_components/question-types';
import { TEMPLATES } from './_components/templates';
import { getBuilderMessages, tb, type TemplateId } from './_components/builder-messages';
import type { EditorMessages } from './_components/messages';
import './_components/builder.css';

type Tab = 'build' | 'logic' | 'connect' | 'results' | 'design';
type SaveStatus = 'saved' | 'saving' | 'draft' | 'error';
const AUTOSAVE_MS = 900;
/** One backoff retry after a failed/transient save so a blip self-heals. */
const RETRY_MS = 1500;
/** Same admin API base the server-side admin-api client uses (client-exposed). */
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

const TAB_IDS: readonly Tab[] = ['build', 'logic', 'connect', 'results', 'design'];
/** Unknown/absent `?tab` → build (the default view). */
const parseTab = (value: string | null): Tab =>
  TAB_IDS.includes(value as Tab) ? (value as Tab) : 'build';

/**
 * Re-anchor a 1-based flow marker position (partialSubmitAfterStep /
 * revealAfterStep) after a step is DELETED, keeping it attached to the step it
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
  publicPath,
  locale,
  m,
  initialHasDraft = false,
}: {
  id: string;
  initialName: string;
  initialConfig: FormConfig;
  publicPath: string;
  locale: string;
  m: EditorMessages;
  /** Whether the form already had an unpublished draft when the page loaded. */
  initialHasDraft?: boolean;
}) {
  const bm = getBuilderMessages(locale);
  const searchParams = useSearchParams();
  const [name, setName] = useState(initialName);
  const [config, setConfig] = useState<FormConfig>(initialConfig);
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
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [status, setStatus] = useState<SaveStatus>(initialConfig.steps.length ? 'saved' : 'draft');
  const [focusCanvas, setFocusCanvas] = useState(0);
  const [saveCount, setSaveCount] = useState(0);
  // The server's reason for the last failed save — shown in the status tooltip.
  const [lastError, setLastError] = useState<string | null>(null);
  const dirty = useRef(false);
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Freshest name/config for the leave handlers + retry (no stale closures).
  const latest = useRef({ name, config });
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  // --- Autosave (debounced; each successful save stores an unpublished draft) ---
  // Bulletproofing: (1) surface WHY a save failed, (2) client-side pre-validate
  // so a doomed PUT never fires, (4) auto-retry a transient failure once — and
  // keep `dirty` true until a save actually SUCCEEDS so nothing is silently lost.
  const persist = useCallback(
    async (nextName: string, nextConfig: FormConfig, opts?: { isRetry?: boolean }): Promise<boolean> => {
      const normalized = normalizeConfig(nextConfig);
      const parsed = formConfigSchema.safeParse(normalized);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const field = issue?.path.join('.') || 'config';
        const reason = `${field}: ${issue?.message ?? 'invalid value'}`;
        setStatus('error');
        setLastError(reason);
        console.error('[forms] autosave blocked — config failed validation:', reason, parsed.error.issues);
        toastRef.current.error(tb(m.saveInvalid, { reason }));
        return false; // dirty stays true; the next edit re-attempts
      }
      setStatus('saving');
      const res = await saveFormAction(id, { name: nextName, config: normalized });
      if (res.ok) {
        dirty.current = false;
        setStatus('saved');
        setLastError(null);
        setSaveCount((n) => n + 1);
        return true;
      }
      const reason = res.message ?? 'unknown error';
      console.error('[forms] autosave failed:', reason);
      setStatus('error');
      setLastError(reason);
      if (!opts?.isRetry) {
        toastRef.current.error(tb(m.saveErrorReason, { reason }));
        if (retry.current) clearTimeout(retry.current);
        retry.current = setTimeout(() => {
          void persist(latest.current.name, latest.current.config, { isRetry: true });
        }, RETRY_MS);
      }
      return false; // dirty stays true until a save actually succeeds
    },
    [id, m],
  );

  useEffect(() => {
    latest.current = { name, config };
  }, [name, config]);

  useEffect(() => {
    if (!dirty.current) return;
    const t = setTimeout(() => void persist(name, config), AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [name, config, persist]);

  // (3) Flush a pending (debounced) save on leave so a change still sitting in
  // the debounce window is never dropped. `beacon` = a keepalive PUT that
  // survives a hard tab close/reload; the SPA-nav + tab-hidden paths use the
  // cookie-authed server action (the component is still able to fire it).
  const flush = useCallback(
    (beacon: boolean) => {
      if (!dirty.current) return;
      const { name: n, config: c } = latest.current;
      const normalized = normalizeConfig(c);
      if (!formConfigSchema.safeParse(normalized).success) return; // never flush invalid config
      if (beacon) {
        try {
          void fetch(`${API_BASE}/v1/forms/${id}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: n, config: normalized }),
            keepalive: true,
            credentials: 'include',
          });
        } catch {
          /* best-effort on the unload path — nothing to recover to */
        }
      } else {
        void persist(n, c);
      }
    },
    [id, persist],
  );
  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flushRef.current(false);
    };
    const onBeforeUnload = () => flushRef.current(true);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('beforeunload', onBeforeUnload);
      if (retry.current) clearTimeout(retry.current);
      flushRef.current(false); // SPA nav / unmount → reliable server-action flush
    };
  }, []); // subscribe once; the cleanup flushes exactly once on real unmount

  function mutate(updater: (c: FormConfig) => FormConfig) {
    dirty.current = true;
    setStatus('saving');
    setConfig(updater);
  }
  function rename(next: string) {
    dirty.current = true;
    setStatus('saving');
    setName(next);
  }

  // --- Step operations ------------------------------------------------------
  function patchStep(index: number, patch: Partial<FormStep>) {
    mutate((c) => ({ ...c, steps: c.steps.map((s, i) => (i === index ? { ...s, ...patch } : s)) }));
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
    void renameQuestionMappingAction(id, oldKey, nextKey).then((res) => {
      if (!res.ok && res.code === 'error') {
        // The config rename already applied and autosaved; only the CRM mapping
        // is behind. Say so rather than implying the whole rename failed.
        toastRef.current.error(m.behavior.fieldKeyMappingFailed);
      }
    });
  }
  function addFromGallery(item: GalleryItem) {
    mutate((c) => {
      const step = stepFromGalleryItem(item, new Set(c.steps.map((s) => s.key)));
      const steps = [...c.steps, step];
      setSelected(steps.length - 1);
      return { ...c, steps };
    });
    setGalleryOpen(false);
    setTab('build');
    setFocusCanvas((n) => n + 1);
  }
  function deleteStep(index: number) {
    mutate((c) => {
      const steps = c.steps.filter((_, i) => i !== index);
      // Keep both 1-based flow markers (partial-submit + reveal) anchored to the
      // step they fire AFTER when a step is deleted.
      return {
        ...c,
        steps,
        partialSubmitAfterStep: reanchorAfterDelete(c.partialSubmitAfterStep, index, c.steps.length),
        revealAfterStep: reanchorAfterDelete(c.revealAfterStep, index, c.steps.length),
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
    mutate((c) => {
      const steps = [...c.steps];
      const [moved] = steps.splice(from, 1);
      if (!moved) return c;
      steps.splice(to, 0, moved);
      // Keep both 1-based flow markers attached to the step they fire AFTER.
      return {
        ...c,
        steps,
        partialSubmitAfterStep: reanchorAfterReorder(c.partialSubmitAfterStep, c.steps, steps),
        revealAfterStep: reanchorAfterReorder(c.revealAfterStep, c.steps, steps),
      };
    });
    setSelected((sel) => {
      if (sel == null) return null;
      if (sel === from) return to;
      if (from < sel && to >= sel) return sel - 1;
      if (from > sel && to <= sel) return sel + 1;
      return sel;
    });
  }
  function applyTemplate(tid: TemplateId) {
    const cfg = TEMPLATES[tid];
    dirty.current = true;
    // Preserve a name the user already typed; only fall back to the template's
    // name when the field is still blank (V4-11 — templates swap config, not name).
    setName((n) => (n.trim() ? n : bm.empty.templates[tid].name));
    setConfig(cfg);
    setSelected(0);
    setTab('build');
    setStatus('saving');
  }

  const patchCover = (patch: Partial<FormCover>) =>
    mutate((c) => ({ ...c, cover: { ...c.cover, ...patch } }));
  const patchBranding = (patch: Partial<FormBranding>) =>
    mutate((c) => ({ ...c, branding: { ...c.branding, ...patch } }));
  const setScoring = (enabled: boolean) => mutate((c) => ({ ...c, scoring: { enabled } }));
  const setOutcomes = (outcomes: FormOutcome[]) => mutate((c) => ({ ...c, outcomes }));
  const patchReveal = (patch: Partial<FormReveal>) =>
    mutate((c) => ({ ...c, reveal: { ...c.reveal, ...patch } }));
  /** Form-level ending copy/redirect — the defaults score ranges override (V5-B1). */
  const patchEnding = (patch: Partial<FormEnding>) =>
    mutate((c) => ({ ...c, ending: { ...c.ending, ...patch } }));
  const setPartialSubmitAfterStep = (afterStep: number | undefined) =>
    mutate((c) => ({ ...c, partialSubmitAfterStep: afterStep }));
  // WHERE the reveal plays (V4-04). Setting a value pins the reveal after that
  // 1-based step; `undefined` reverts to the engine default (after the last
  // step). Removing the marker turns the reveal OFF (Design owns enablement) and
  // clears the position so a later re-enable defaults back to the end.
  const setRevealAfterStep = (afterStep: number | undefined) =>
    mutate((c) => ({ ...c, revealAfterStep: afterStep }));
  const removeReveal = () =>
    mutate((c) => ({ ...c, reveal: { ...c.reveal, enabled: false }, revealAfterStep: undefined }));
  // `tracking` is additive config the engine type omits; the autosave/publish
  // flow round-trips it (normalizeConfig passes unknown top-level keys through).
  const setTracking = (tracking: FormTracking | undefined) =>
    mutate((c) => ({ ...c, tracking }) as FormConfig);

  const selectedStep = selected != null ? config.steps[selected] : undefined;
  const scoringEnabled = config.scoring?.enabled !== false;
  // Mirrors the renderer/engine gate: the reveal marker shows when reveal exists
  // AND is not explicitly disabled.
  const revealEnabled = config.reveal != null && config.reveal.enabled !== false;
  const hasQuestions = config.steps.length > 0;

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: 'build', label: bm.shell.tabBuild, icon: 'pi-th-large' },
    { id: 'logic', label: bm.shell.tabLogic, icon: 'pi-sitemap' },
    { id: 'connect', label: m.connect.tab, icon: 'pi-link' },
    { id: 'results', label: bm.shell.tabResults, icon: 'pi-chart-line' },
    { id: 'design', label: bm.shell.tabDesign, icon: 'pi-palette' },
  ];

  const statusLabel =
    status === 'saving'
      ? bm.shell.saving
      : status === 'error'
        ? bm.shell.saveError
        : hasQuestions
          ? bm.shell.saved
          : bm.shell.draft;
  const statusDot =
    status === 'error' ? 'bg-destructive' : status === 'saving' ? 'bg-muted-foreground' : 'bg-primary';

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-background">
      {/* Topbar */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-3 sm:px-4">
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
          className="min-w-0 max-w-[38ch] flex-1 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-base font-semibold tracking-tight hover:border-border focus-visible:border-input focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:flex-none sm:text-lg"
        />
        <span
          className={cn(
            'hidden items-center gap-1.5 text-xs text-muted-foreground sm:inline-flex',
            status === 'error' && lastError ? 'cursor-help' : '',
          )}
          data-testid="editor-save-status"
          data-status={status}
          // Native tooltip: hover the "Not saved" indicator to read WHY it failed.
          title={status === 'error' && lastError ? tb(m.saveErrorReason, { reason: lastError }) : undefined}
        >
          <span className={cn('h-1.5 w-1.5 rounded-full', statusDot)} />
          {statusLabel}
        </span>

        <div className="ml-auto flex items-center gap-2">
          {/* Tabs (segmented) */}
          <nav className="hidden items-center gap-0.5 rounded-lg border border-border bg-card p-0.5 md:flex" aria-label="Sections">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                data-testid={`editor-tab-${t.id}`}
                onClick={() => setTab(t.id)}
                aria-current={tab === t.id}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  tab === t.id ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <i aria-hidden className={`pi ${t.icon}`} style={{ fontSize: 12 }} />
                {t.label}
              </button>
            ))}
          </nav>

          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <i aria-hidden className="pi pi-eye" style={{ fontSize: 13 }} />
            <span className="hidden sm:inline">{bm.shell.preview}</span>
          </button>
          <LinkActions
            publicPath={publicPath}
            labels={{ copyLink: bm.shell.copyLink, copied: bm.shell.copied, openForm: bm.shell.openForm }}
          />
          <PublishButton
            formId={id}
            initialHasDraft={initialHasDraft}
            saveCount={saveCount}
            locale={locale}
          />
        </div>
      </header>

      {/* Mobile tab bar */}
      <nav className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1.5 md:hidden" aria-label="Sections">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            data-testid={`editor-tab-${t.id}-mobile`}
            onClick={() => setTab(t.id)}
            aria-current={tab === t.id}
            className={cn(
              'inline-flex flex-1 items-center justify-center gap-1.5 rounded-md py-2 text-xs font-medium transition-colors',
              tab === t.id ? 'bg-muted text-foreground' : 'text-muted-foreground',
            )}
          >
            <i aria-hidden className={`pi ${t.icon}`} style={{ fontSize: 12 }} />
            {t.label}
          </button>
        ))}
      </nav>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === 'build' ? (
          hasQuestions ? (
            <div className="grid h-full grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)_360px]">
              {/* Left spine */}
              <aside className="hidden min-h-0 overflow-y-auto lg:block">
                <QuestionSpine
                  steps={config.steps}
                  selectedIndex={selected}
                  onSelect={setSelected}
                  onReorder={reorderSteps}
                  onAdd={() => setGalleryOpen(true)}
                  partialAfterStep={config.partialSubmitAfterStep}
                  onPartialChange={setPartialSubmitAfterStep}
                  revealEnabled={revealEnabled}
                  revealAfterStep={config.revealAfterStep}
                  onRevealMove={setRevealAfterStep}
                  onRevealRemove={removeReveal}
                  onOpenDesign={() => setTab('design')}
                  m={bm}
                />
              </aside>

              {/* Center canvas */}
              <main className="flex min-h-0 flex-col overflow-y-auto">
                <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5 text-sm text-muted-foreground">
                  <span className="truncate">
                    {selected != null
                      ? `${tb(bm.shell.questionOfTotal, { n: selected + 1, total: config.steps.length })} · ${bm.shell.editingLive}`
                      : ''}
                  </span>
                  <div className="flex shrink-0 items-center gap-0.5 rounded-lg border border-border bg-card p-0.5">
                    {(['desktop', 'mobile'] as const).map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setDevice(d)}
                        aria-current={device === d}
                        className={cn(
                          'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                          device === d ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
                        )}
                      >
                        {d === 'desktop' ? bm.shell.desktop : bm.shell.mobile}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex-1 px-4 py-6 sm:px-8">
                  {selectedStep && selected != null ? (
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
                  ) : (
                    <p className="py-16 text-center text-sm text-muted-foreground">{bm.settings.empty}</p>
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
                        i === selected ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground',
                      )}
                    >
                      <span className="font-bold tabular-nums">{i + 1}</span>
                      <span className="max-w-[9ch] truncate">{s.question?.trim() || bm.canvas.titlePlaceholder}</span>
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
                    step={selectedStep}
                    index={selected}
                    steps={config.steps}
                    scoringEnabled={scoringEnabled}
                    onUpdate={(patch) => patchStep(selected, patch)}
                    onDelete={() => deleteStep(selected)}
                    bm={bm}
                    em={m}
                    formId={id}
                    locale={locale}
                    onOpenConnect={() => setTab('connect')}
                    onOpenDesign={() => setTab('design')}
                    revealAfterStep={config.revealAfterStep}
                    onRevealAfterStepChange={setRevealAfterStep}
                    onRenameKey={(nextKey) => renameStepKey(selected, nextKey)}
                  />
                ) : null}
              </aside>
            </div>
          ) : (
            <div className="h-full overflow-y-auto">
              <EmptyState onPickTemplate={applyTemplate} onScratch={() => setGalleryOpen(true)} m={bm} />
            </div>
          )
        ) : tab === 'logic' ? (
          <div className="h-full overflow-y-auto px-4 py-6 sm:px-8">
            <p className="mb-4 text-sm text-muted-foreground">{bm.map.title}</p>
            <LogicMap config={config} m={bm} />
          </div>
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
        ) : tab === 'results' ? (
          <div className="h-full overflow-y-auto">
            <ResultsView
              config={config}
              onScoringChange={setScoring}
              onOutcomesChange={setOutcomes}
              onStepScoringChange={(index, on) => patchStep(index, { scoringEnabled: on ? undefined : false })}
              m={bm}
              rm={m.resultsHelp}
            />
          </div>
        ) : (
          <div className="flex h-full flex-col gap-4 overflow-y-auto px-4 py-6 sm:px-8">
            <CoverPanel config={config} onCoverChange={patchCover} onBrandingChange={patchBranding} m={m} />
            <RevealPanel
              config={config}
              onRevealChange={patchReveal}
              partialNote={bm.partial.designNote}
              m={m}
            />
            <EndingPanel
              config={config}
              onEndingChange={patchEnding}
              hasOutcomes={(config.outcomes?.length ?? 0) > 0 && scoringEnabled}
              m={m}
            />
          </div>
        )}
      </div>

      <TypeGallery open={galleryOpen} onClose={() => setGalleryOpen(false)} onPick={addFromGallery} m={bm} />
      <DevicePreviewModal open={previewOpen} onClose={() => setPreviewOpen(false)} publicPath={publicPath} m={m.preview} />
    </div>
  );
}
