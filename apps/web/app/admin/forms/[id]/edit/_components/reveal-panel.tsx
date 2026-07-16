'use client';

import type { FormConfig, FormReveal } from '@quill/engine';
import { Switch } from '@/components/ui/switch';
import { Field, TextField, TextArea, NumberField, InlineField, PanelSection } from './fields';
import type { EditorMessages } from './messages';

const DEFAULT_REVEAL_MS = 2200;
const MIN_REVEAL_MS = 500;
const MAX_REVEAL_MS = 30_000;

/**
 * Design-tab panel for the reveal/processing interstitial (`config.reveal`).
 * WHICH question plays the reveal is a per-question Behavior toggle
 * (`triggersReveal`) in the Build tab; this panel owns the shared copy,
 * duration, and prewarm. The partial-submission threshold moved to the Build
 * tab's question spine (the draggable "Partial submit point" marker) — a short
 * note (`partialNote`) points editors there.
 */
export function RevealPanel({
  config,
  onRevealChange,
  partialNote,
  m,
}: {
  config: FormConfig;
  onRevealChange: (patch: Partial<FormReveal>) => void;
  /** One-line pointer to the question-spine marker (builder catalog string). */
  partialNote: string;
  m: EditorMessages;
}) {
  const reveal = config.reveal ?? {};
  // Mirrors the renderer's gate: a reveal plays when config.reveal exists AND
  // enabled !== false.
  const enabled = config.reveal != null && reveal.enabled !== false;

  return (
    <div className="flex flex-col gap-4">
      <PanelSection title={m.reveal.title} subtitle={m.reveal.subtitle}>
        <InlineField label={m.reveal.enabled} hint={m.reveal.stepHint}>
          <Switch
            checked={enabled}
            onCheckedChange={(v) => onRevealChange({ enabled: v })}
            aria-label={m.reveal.enabled}
          />
        </InlineField>
        {enabled ? (
          <>
            <Field label={m.reveal.headline}>
              <TextField
                value={reveal.headline ?? ''}
                placeholder={m.reveal.headlinePlaceholder}
                onChange={(e) => onRevealChange({ headline: e.target.value || null })}
              />
            </Field>
            <Field label={m.reveal.subtitleLabel}>
              <TextArea
                value={reveal.subtitle ?? ''}
                rows={2}
                placeholder={m.reveal.subtitlePlaceholder}
                onChange={(e) => onRevealChange({ subtitle: e.target.value || null })}
              />
            </Field>
            <Field label={m.reveal.template} hint={m.reveal.templateHint}>
              <TextField
                value={reveal.subtitleTemplate ?? ''}
                onChange={(e) => onRevealChange({ subtitleTemplate: e.target.value || null })}
              />
            </Field>
            <Field label={m.reveal.duration} hint={m.reveal.durationHint}>
              <NumberField
                value={reveal.durationMs ?? ''}
                placeholder={String(DEFAULT_REVEAL_MS)}
                min={MIN_REVEAL_MS}
                max={MAX_REVEAL_MS}
                step={100}
                onChange={(e) => {
                  const n = e.target.value === '' ? undefined : Number(e.target.value);
                  onRevealChange({ durationMs: n != null && !Number.isNaN(n) ? n : undefined });
                }}
                onBlur={(e) => {
                  // Clamp into the schema's 500–30000ms window once typing ends.
                  if (e.target.value === '') return;
                  const n = Number(e.target.value);
                  if (Number.isNaN(n)) return onRevealChange({ durationMs: undefined });
                  const clamped = Math.min(MAX_REVEAL_MS, Math.max(MIN_REVEAL_MS, Math.round(n)));
                  if (clamped !== n) onRevealChange({ durationMs: clamped });
                }}
                className="max-w-[10rem]"
              />
            </Field>
            <InlineField label={m.reveal.prewarm} hint={m.reveal.prewarmHint}>
              <Switch
                checked={!!reveal.prewarm}
                onCheckedChange={(v) => onRevealChange({ prewarm: v || undefined })}
                aria-label={m.reveal.prewarm}
              />
            </InlineField>
          </>
        ) : null}
      </PanelSection>

      <PanelSection title={m.partial.title} subtitle={m.partial.hint}>
        {/* The threshold itself is authored in the Build tab's question spine
            (draggable "Partial submit point" marker); only this pointer stays. */}
        <p data-testid="partial-point-design-note" className="text-sm text-muted-foreground">
          {partialNote}
        </p>
      </PanelSection>
    </div>
  );
}
