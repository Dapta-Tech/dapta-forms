'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import type { FormConfig, FormStep, FormCover, FormBranding, FormOutcome, FormFieldType } from '@quill/engine';
import { createEmptyStep, normalizeConfig } from '@quill/engine';
import { saveFormAction } from '@/app/admin/actions';
import { useToast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { StepList } from './_components/step-list';
import { StepProperties } from './_components/step-properties';
import { CoverPanel } from './_components/cover-panel';
import { OutcomesPanel } from './_components/outcomes-panel';
import { FlowDiagram } from './_components/flow-diagram';
import { LivePreview } from './_components/live-preview';
import { DevicePreviewModal } from './_components/device-preview-modal';
import type { PriorField } from './_components/condition-editor';
import type { EditorMessages } from './_components/messages';

type Tab = 'build' | 'cover' | 'outcomes' | 'flow';

/**
 * The form editor: a step builder (drag-reorder list · per-step properties ·
 * live preview), a cover/branding tab, an outcomes/scoring tab and a read-only
 * flow overview. Config is normalized on save (dedupe keys, canonical order,
 * derived flags) via @quill/engine so the persisted blob is always canonical.
 */
export function FormEditor({
  id,
  initialName,
  initialConfig,
  publicPath,
  m,
}: {
  id: string;
  initialName: string;
  initialConfig: FormConfig;
  publicPath: string;
  m: EditorMessages;
}) {
  const toast = useToast();
  const [name, setName] = useState(initialName);
  const [config, setConfig] = useState<FormConfig>(initialConfig);
  const [tab, setTab] = useState<Tab>('build');
  const [selected, setSelected] = useState<number | null>(initialConfig.steps.length ? 0 : null);
  const [deviceOpen, setDeviceOpen] = useState(false);
  const [pending, start] = useTransition();

  /** Fields defined before `index` — the pool skip-logic / variants can read. */
  const priorFieldsFor = (index: number): PriorField[] =>
    config.steps.slice(0, index).map((s) => ({
      key: s.key,
      label: s.question?.trim() || s.key,
      options: s.options?.map((o) => ({ label: o.label, value: o.value })),
    }));

  function patchStep(index: number, patch: Partial<FormStep>) {
    setConfig((c) => ({ ...c, steps: c.steps.map((s, i) => (i === index ? { ...s, ...patch } : s)) }));
  }

  function addStep(type: FormFieldType) {
    setConfig((c) => {
      const step = createEmptyStep(type, new Set(c.steps.map((s) => s.key)));
      const steps = [...c.steps, step];
      setSelected(steps.length - 1);
      return { ...c, steps };
    });
  }

  function deleteStep(index: number) {
    setConfig((c) => ({ ...c, steps: c.steps.filter((_, i) => i !== index) }));
    setSelected((sel) => {
      if (sel == null) return null;
      const nextLen = config.steps.length - 1;
      if (nextLen === 0) return null;
      if (sel === index) return Math.max(0, index - 1);
      return sel > index ? sel - 1 : sel;
    });
  }

  function reorderSteps(from: number, to: number) {
    setConfig((c) => {
      const steps = [...c.steps];
      const [moved] = steps.splice(from, 1);
      if (!moved) return c;
      steps.splice(to, 0, moved);
      return { ...c, steps };
    });
    setSelected((sel) => {
      if (sel == null) return null;
      if (sel === from) return to;
      if (from < sel && to >= sel) return sel - 1;
      if (from > sel && to <= sel) return sel + 1;
      return sel;
    });
  }

  function patchCover(patch: Partial<FormCover>) {
    setConfig((c) => ({ ...c, cover: { ...c.cover, ...patch } }));
  }
  function patchBranding(patch: Partial<FormBranding>) {
    setConfig((c) => ({ ...c, branding: { ...c.branding, ...patch } }));
  }
  function setScoring(enabled: boolean) {
    setConfig((c) => ({ ...c, scoring: { enabled } }));
  }
  function setOutcomes(outcomes: FormOutcome[]) {
    setConfig((c) => ({ ...c, outcomes }));
  }

  function save() {
    const normalized = normalizeConfig(config);
    start(async () => {
      const res = await saveFormAction(id, { name, config: normalized });
      if (res.ok) {
        setConfig(normalized);
        // Selection index may shift if empty steps were reordered; clamp it.
        setSelected((sel) => (sel == null ? null : Math.min(sel, normalized.steps.length - 1)));
        toast.success(m.saved);
      } else {
        toast.error(res.message ?? m.saveError);
      }
    });
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'build', label: m.tabs.build },
    { id: 'cover', label: m.tabs.cover },
    { id: 'outcomes', label: m.tabs.outcomes },
    { id: 'flow', label: m.tabs.flow },
  ];

  const selectedStep = selected != null ? config.steps[selected] : undefined;

  return (
    <div className="min-h-dvh">
      {/* Sticky header: back · name · preview + save (one primary CTA — R30). */}
      <div className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
        <div className="mx-auto flex max-w-[1520px] flex-col gap-3 px-4 pb-3 pt-4 sm:px-6">
          <Link
            href="/admin/forms"
            className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <i aria-hidden className="pi pi-chevron-left" style={{ fontSize: 12 }} />
            {m.back}
          </Link>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={m.formNamePlaceholder}
              aria-label={m.formNamePlaceholder}
              className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1 py-1 text-2xl font-semibold tracking-tight hover:border-border focus-visible:border-input focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div className="flex shrink-0 items-center gap-2">
              <Button variant="outline" onClick={() => setDeviceOpen(true)}>
                <i aria-hidden className="pi pi-eye" style={{ fontSize: 13 }} /> {m.previewBtn}
              </Button>
              <Button onClick={save} disabled={pending} className="min-w-[92px]">
                {pending ? m.saving : m.save}
              </Button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 overflow-x-auto">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                aria-current={tab === t.id}
                className={cn(
                  'whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  tab === t.id
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[1520px] px-4 py-6 sm:px-6">
        {tab === 'build' ? (
          <div className="grid gap-4 lg:grid-cols-[minmax(220px,260px)_minmax(0,1fr)_minmax(320px,400px)]">
            <aside className="lg:sticky lg:top-[9.5rem] lg:self-start">
              <StepList
                steps={config.steps}
                selectedIndex={selected}
                onSelect={setSelected}
                onReorder={reorderSteps}
                onAdd={addStep}
                m={m}
              />
            </aside>

            <div className="min-w-0">
              {selectedStep && selected != null ? (
                <StepProperties
                  step={selectedStep}
                  index={selected}
                  priorFields={priorFieldsFor(selected)}
                  onUpdate={(patch) => patchStep(selected, patch)}
                  onDelete={() => deleteStep(selected)}
                  m={m}
                />
              ) : (
                <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
                  {m.steps.select}
                </div>
              )}
            </div>

            <aside className="lg:sticky lg:top-[9.5rem] lg:self-start">
              <p className="mb-2 text-sm font-semibold text-foreground">{m.preview.title}</p>
              <LivePreview config={config} selected={selected ?? 'cover'} m={m.preview} />
            </aside>
          </div>
        ) : tab === 'cover' ? (
          <CoverPanel config={config} onCoverChange={patchCover} onBrandingChange={patchBranding} m={m} />
        ) : tab === 'outcomes' ? (
          <OutcomesPanel config={config} onScoringChange={setScoring} onOutcomesChange={setOutcomes} m={m} />
        ) : (
          <div>
            <div className="mb-4">
              <h2 className="text-sm font-semibold text-foreground">{m.flow.title}</h2>
              <p className="text-xs text-muted-foreground">{m.flow.subtitle}</p>
            </div>
            <FlowDiagram config={config} m={m} />
          </div>
        )}
      </div>

      <DevicePreviewModal
        open={deviceOpen}
        onClose={() => setDeviceOpen(false)}
        publicPath={publicPath}
        m={m.preview}
      />
    </div>
  );
}
