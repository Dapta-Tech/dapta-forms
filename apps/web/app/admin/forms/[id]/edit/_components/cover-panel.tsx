'use client';

import type { FormConfig, FormCover, FormBranding } from '@quill/engine';
import { clampAccent, accentWasAdjusted, DEFAULT_ACCENT } from '@quill/shared';
import { Switch } from '@/components/ui/switch';
import { Field, TextField, TextArea, InlineField, PanelSection } from './fields';
import { LivePreview } from './live-preview';
import type { EditorMessages } from './messages';

/**
 * Cover / intro editor + per-form branding. The color picker feeds
 * `branding.primaryColor`; the swatch shows the AA-clamped accent the public
 * page will actually use, warning when the raw pick had to be nudged lighter.
 * A live cover preview sits alongside so edits are visible immediately.
 */
export function CoverPanel({
  config,
  onCoverChange,
  onBrandingChange,
  m,
}: {
  config: FormConfig;
  onCoverChange: (patch: Partial<FormCover>) => void;
  onBrandingChange: (patch: Partial<FormBranding>) => void;
  m: EditorMessages;
}) {
  const cover = config.cover ?? {};
  const raw = config.branding?.primaryColor || DEFAULT_ACCENT;
  const clamped = clampAccent(raw);
  const adjusted = accentWasAdjusted(raw);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
      <div className="flex flex-col gap-4">
        <PanelSection title={m.cover.title} subtitle={m.cover.subtitle}>
          <InlineField label={m.cover.enabled}>
            <Switch
              checked={cover.enabled !== false}
              onCheckedChange={(v) => onCoverChange({ enabled: v })}
              aria-label={m.cover.enabled}
            />
          </InlineField>
          <Field label={m.cover.bannerText}>
            <TextField value={cover.bannerText ?? ''} onChange={(e) => onCoverChange({ bannerText: e.target.value || null })} />
          </Field>
          <Field label={m.cover.eyebrow}>
            <TextField value={cover.eyebrow ?? ''} onChange={(e) => onCoverChange({ eyebrow: e.target.value || null })} />
          </Field>
          <Field label={m.cover.headline}>
            <TextField value={cover.headline ?? ''} onChange={(e) => onCoverChange({ headline: e.target.value || null })} />
          </Field>
          <Field label={m.cover.subheadline}>
            <TextArea value={cover.subheadline ?? ''} rows={2} onChange={(e) => onCoverChange({ subheadline: e.target.value || null })} />
          </Field>
          <Field label={m.cover.ctaText}>
            <TextField value={cover.ctaText ?? ''} onChange={(e) => onCoverChange({ ctaText: e.target.value || null })} />
          </Field>
          <Field label={m.cover.trustBadge}>
            <TextField value={cover.trustBadge ?? ''} onChange={(e) => onCoverChange({ trustBadge: e.target.value || null })} />
          </Field>
        </PanelSection>

        <PanelSection title={m.cover.branding}>
          <Field label={m.cover.primaryColor} hint={m.cover.primaryColorHint}>
            <div className="flex items-center gap-3">
              <input
                type="color"
                aria-label={m.cover.primaryColor}
                value={/^#[0-9a-fA-F]{6}$/.test(raw) ? raw : DEFAULT_ACCENT}
                onChange={(e) => onBrandingChange({ primaryColor: e.target.value })}
                className="h-10 w-14 shrink-0 cursor-pointer rounded-md border border-input bg-background p-1"
              />
              <TextField
                value={raw}
                onChange={(e) => onBrandingChange({ primaryColor: e.target.value })}
                className="max-w-[10rem] font-mono"
              />
              <span
                aria-hidden
                title={clamped}
                className="h-8 w-8 shrink-0 rounded-full border border-border"
                style={{ background: clamped }}
              />
            </div>
          </Field>
          {adjusted ? (
            <p className="text-xs text-muted-foreground">
              <i aria-hidden className="pi pi-info-circle" style={{ fontSize: 11 }} />{' '}
              {clamped}
            </p>
          ) : null}
        </PanelSection>
      </div>

      <div className="lg:sticky lg:top-[7.5rem] lg:self-start">
        <p className="mb-2 text-sm font-semibold text-foreground">{m.preview.title}</p>
        <LivePreview config={config} selected="cover" m={m.preview} />
      </div>
    </div>
  );
}
