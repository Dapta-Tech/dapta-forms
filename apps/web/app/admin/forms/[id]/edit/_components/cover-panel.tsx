'use client';

import type { FormConfig, FormCover, FormBranding, FormClientLogo } from '@quill/engine';
import { isSafeImageUrl } from '@quill/engine';
import { clampAccent, accentWasAdjusted, DEFAULT_ACCENT } from '@quill/shared';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Field, TextField, TextArea, InlineField, PanelSection } from './fields';
import { LivePreview } from './live-preview';
import type { EditorMessages } from './messages';

/** The schema caps `clientLogos` at 24 entries. */
const MAX_CLIENT_LOGOS = 24;

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
          <Field label={m.cover.badge}>
            <TextField value={cover.badge ?? ''} onChange={(e) => onCoverChange({ badge: e.target.value || null })} />
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
          <Field label={m.cover.logo} hint={m.cover.logoHint}>
            <TextField
              value={cover.logo ?? ''}
              placeholder="https://…"
              onChange={(e) => onCoverChange({ logo: e.target.value || null })}
            />
          </Field>
          {cover.logo && !isSafeImageUrl(cover.logo) ? (
            <p className="text-xs text-destructive" role="alert">
              {m.cover.logoInvalid}
            </p>
          ) : null}
        </PanelSection>

        <PanelSection title={m.cover.clientLogos} subtitle={m.cover.clientLogosHint}>
          <ClientLogosEditor
            logos={cover.clientLogos ?? []}
            onChange={(clientLogos) => onCoverChange({ clientLogos: clientLogos.length ? clientLogos : undefined })}
            m={m}
          />
        </PanelSection>
      </div>

      <div className="lg:sticky lg:top-[7.5rem] lg:self-start">
        <p className="mb-2 text-sm font-semibold text-foreground">{m.preview.title}</p>
        <LivePreview config={config} selected="cover" m={m.preview} />
      </div>
    </div>
  );
}

/**
 * The cover's "trusted by" marquee entries ({name, src?}): name renders as a
 * text chip when no image URL is set. Capped at the schema's 24 entries; unsafe
 * image protocols are flagged inline (the save schema rejects them too).
 */
function ClientLogosEditor({
  logos,
  onChange,
  m,
}: {
  logos: FormClientLogo[];
  onChange: (next: FormClientLogo[]) => void;
  m: EditorMessages;
}) {
  function update(index: number, patch: Partial<FormClientLogo>) {
    onChange(logos.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  return (
    <div className="flex flex-col gap-2">
      {logos.length === 0 ? (
        <p className="text-xs text-muted-foreground">{m.cover.clientLogosEmpty}</p>
      ) : (
        logos.map((logo, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-md border border-border bg-background p-2">
            <div className="flex items-end gap-2">
              <label className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-[11px] font-medium text-muted-foreground">{m.cover.clientLogoName}</span>
                <TextField
                  value={logo.name}
                  onChange={(e) => update(i, { name: e.target.value })}
                  className="h-8 py-1 text-xs"
                />
              </label>
              <label className="flex min-w-0 flex-[2] flex-col gap-1">
                <span className="text-[11px] font-medium text-muted-foreground">{m.cover.clientLogoSrc}</span>
                <TextField
                  value={logo.src ?? ''}
                  placeholder="https://…"
                  onChange={(e) => update(i, { src: e.target.value || null })}
                  className="h-8 py-1 text-xs"
                />
              </label>
              <Button
                variant="ghost"
                size="icon"
                aria-label={m.cover.removeClientLogo}
                onClick={() => onChange(logos.filter((_, li) => li !== i))}
                className="mb-0.5 shrink-0 text-muted-foreground hover:text-destructive"
              >
                <i aria-hidden className="pi pi-trash" style={{ fontSize: 13 }} />
              </Button>
            </div>
            {logo.src && !isSafeImageUrl(logo.src) ? (
              <p className="text-xs text-destructive" role="alert">
                {m.cover.logoInvalid}
              </p>
            ) : null}
          </div>
        ))
      )}
      <div>
        <Button
          variant="outline"
          size="sm"
          disabled={logos.length >= MAX_CLIENT_LOGOS}
          onClick={() => onChange([...logos, { name: `Logo ${logos.length + 1}` }])}
        >
          <i aria-hidden className="pi pi-plus" style={{ fontSize: 11 }} /> {m.cover.addClientLogo}
        </Button>
      </div>
    </div>
  );
}
