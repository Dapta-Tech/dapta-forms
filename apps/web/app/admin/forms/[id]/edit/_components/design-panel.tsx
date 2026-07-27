'use client';

import { useState } from 'react';
import type { FormBranding, FormConfig, FormCover } from '@quill/engine';
import {
  DEFAULT_FORM_FONT,
  FORM_BACKGROUND_STYLES,
  isSafeImageUrl,
  resolveDesign,
} from '@quill/engine';
import {
  DEFAULT_ACCENT,
  DEFAULT_CANVAS,
  DEFAULT_CANVAS_FOREGROUND,
  accentWasAdjusted,
  clampAccent,
  contrastGrade,
  contrastRatio,
  onAccent,
  readableOn,
  t,
} from '@quill/shared';
import { Switch } from '@/components/ui/switch';
import { Field, InlineField, NumberField, PanelSection, SegmentedToggle, TextField } from './fields';
import { ColorPicker } from './color-picker';
import { FontPicker } from './font-picker';
import { ThemePresets } from './theme-presets';
import { PreviewFrame, type PreviewDevice } from './preview-frame';
import { LivePreview } from './live-preview';
import { cn } from '@/lib/cn';
import type { EditorMessages } from './messages';

/**
 * The Design tab.
 *
 * Two columns: every control on the left, a large device-framed preview of the
 * real form on the right. The preview used to be a 420px box pinned beside the
 * cover copy fields, showing only the cover — so half of what this tab changes
 * was invisible from it.
 *
 * The sections are ordered by how much each decision constrains the next:
 * a theme preset sets everything at once, colors and type are the ground the
 * rest sits on, shape and layout are refinements, and the cover copy — which is
 * writing, not design — comes last. Client logos get their own section instead
 * of being buried in the cover.
 */
export function DesignPanel({
  config,
  name,
  publicPath,
  locale,
  onCoverChange,
  onBrandingChange,
  children,
  m,
}: {
  config: FormConfig;
  name: string;
  publicPath: string;
  locale: string;
  onCoverChange: (patch: Partial<FormCover>) => void;
  onBrandingChange: (patch: Partial<FormBranding>) => void;
  /** Non-design panels that share this tab (flow note, ending) — rendered last. */
  children?: React.ReactNode;
  m: EditorMessages;
}) {
  const [device, setDevice] = useState<PreviewDevice>('desktop');
  const [screen, setScreen] = useState<number | 'cover'>('cover');

  const d = m.design;
  const branding = config.branding ?? {};
  const design = resolveDesign(branding);

  // The colors every contrast readout is measured against. When the author has
  // not chosen a ground, that is the shared dark canvas the form actually
  // renders on — measuring against white would grade a form nobody will see.
  const ground = branding.background?.trim() || DEFAULT_CANVAS;
  const text = branding.foreground?.trim() || (branding.background ? readableOn(ground) : DEFAULT_CANVAS_FOREGROUND);
  // The accent the form will ACTUALLY paint, not the raw pick — the clamp may
  // have moved it, and grading the raw value would describe a color nobody sees.
  const accent = clampAccent(branding.primaryColor || DEFAULT_ACCENT, ground);
  const accentAdjusted = branding.primaryColor ? accentWasAdjusted(branding.primaryColor, ground) : false;

  const screens: { value: number | 'cover'; label: string }[] = [
    { value: 'cover', label: m.preview.coverTitle },
    ...config.steps.map((s, i) => ({ value: i, label: `${i + 1}. ${s.key}` })),
  ];

  return (
    <div className="grid h-full min-h-0 gap-4 px-4 py-6 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,46%)] lg:overflow-hidden">
      {/* ── Controls ───────────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-col gap-4 lg:overflow-y-auto lg:pr-1">
        <PanelSection title={d.presetsTitle} subtitle={d.presetsSubtitle}>
          <ThemePresets branding={branding} onApply={onBrandingChange} m={d} />
        </PanelSection>

        <PanelSection title={d.colorsTitle} subtitle={d.colorsSubtitle}>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={d.background}>
              <ColorPicker
                value={branding.background}
                onChange={(background) => onBrandingChange({ background, themePreset: null })}
                label={d.background}
                allowEmpty
                m={d}
              />
            </Field>
            <Field label={d.foreground}>
              <ColorPicker
                value={branding.foreground}
                onChange={(foreground) => onBrandingChange({ foreground, themePreset: null })}
                label={d.foreground}
                against={ground}
                againstLabel={d.contrastText}
                allowEmpty
                m={d}
              />
            </Field>
            <Field label={d.accent}>
              {/* No `against`: an accent is a FILL, not body text. Grading it
                  against the ground at the 4.5:1 body threshold flags a
                  perfectly good brand color as unreadable — the accent only
                  owes 3:1, which `clampAccent` already guarantees and
                  `accentAdjusted` already reports. What is real text is the
                  LABEL on top of it, measured below. */}
              <ColorPicker
                value={branding.primaryColor}
                onChange={(primaryColor) => onBrandingChange({ primaryColor, themePreset: null })}
                label={d.accent}
                allowEmpty
                m={d}
              />
            </Field>
          </div>

          {/* An always-on readout of the pair that actually renders. The badge
              on the Text picker only appears once a color is explicitly set, so
              without this a form using the inherited default — the common case —
              would show no contrast information at all. */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
            <ContrastRow label={d.contrastText} a={text} b={ground} failLabel={d.contrastFail} />
            {/* The two pairs that are actually TEXT on a surface. Only a solid
                button puts the label on the accent; outline and soft put it on
                the form ground, which the first row already covers. */}
            {design.buttonStyle === 'solid' ? (
              <ContrastRow
                label={d.contrastButton}
                a={onAccent(accent)}
                b={accent}
                failLabel={d.contrastFail}
              />
            ) : null}
          </div>

          {accentAdjusted ? (
            <p className="text-xs text-muted-foreground">
              <i aria-hidden className="pi pi-info-circle" style={{ fontSize: 11 }} />{' '}
              {t(d.accentAdjusted, { color: clampAccent(branding.primaryColor ?? '', ground) })}
            </p>
          ) : null}
          {branding.background ? (
            <p className="text-xs text-muted-foreground">
              <i aria-hidden className="pi pi-lock" style={{ fontSize: 11 }} /> {d.themeLockHint}
            </p>
          ) : null}

          <InlineField label={d.backgroundStyle}>
            <SegmentedToggle
              value={design.backgroundStyle}
              onChange={(backgroundStyle) => onBrandingChange({ backgroundStyle })}
              options={FORM_BACKGROUND_STYLES.map((s) => ({
                value: s,
                label: s === 'solid' ? d.bgSolid : s === 'gradient' ? d.bgGradient : s === 'glow' ? d.bgGlow : d.bgImage,
              }))}
              ariaLabel={d.backgroundStyle}
            />
          </InlineField>

          {/* Only reachable under `image`, so the combination that renders as a
              blank page can't be assembled by clicking around. */}
          {design.backgroundStyle === 'image' || branding.backgroundStyle === 'image' ? (
            <>
              <Field label={d.backgroundImage} hint={d.backgroundImageHint}>
                <TextField
                  value={branding.backgroundImage ?? ''}
                  placeholder="https://…"
                  onChange={(e) => onBrandingChange({ backgroundImage: e.target.value || null })}
                />
              </Field>
              {branding.backgroundImage && !isSafeImageUrl(branding.backgroundImage) ? (
                <p className="text-xs text-destructive" role="alert">
                  {m.cover.logoInvalid}
                </p>
              ) : null}
              <Field label={d.overlay}>
                <NumberField
                  value={design.backgroundOverlay}
                  min={0}
                  max={100}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    // The resolver clamps too, but keeping the stored value in
                    // range means the field never shows a number the form ignores.
                    if (Number.isFinite(n)) {
                      onBrandingChange({ backgroundOverlay: Math.max(0, Math.min(100, n)) });
                    }
                  }}
                />
              </Field>
            </>
          ) : null}
        </PanelSection>

        <PanelSection title={d.typographyTitle} subtitle={d.typographySubtitle}>
          <Field label={d.font}>
            <FontPicker
              value={branding.fontFamily ?? DEFAULT_FORM_FONT}
              onChange={(fontFamily) => onBrandingChange({ fontFamily, themePreset: null })}
              m={d}
            />
          </Field>
          {branding.fontFamily === 'custom' ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={d.customFontName}>
                <TextField
                  value={branding.customFont?.name ?? ''}
                  placeholder={d.customFontNamePlaceholder}
                  onChange={(e) =>
                    onBrandingChange({
                      customFont: { name: e.target.value, url: branding.customFont?.url ?? '' },
                    })
                  }
                />
              </Field>
              <Field label={d.customFontUrl} hint={d.customFontHint}>
                <TextField
                  value={branding.customFont?.url ?? ''}
                  placeholder="https://…/font.woff2"
                  onChange={(e) =>
                    onBrandingChange({
                      customFont: { name: branding.customFont?.name ?? '', url: e.target.value },
                    })
                  }
                />
              </Field>
            </div>
          ) : null}
        </PanelSection>

        <PanelSection title={d.controlsTitle} subtitle={d.controlsSubtitle}>
          <InlineField label={d.radius}>
            <SegmentedToggle
              value={design.radius}
              onChange={(radius) => onBrandingChange({ radius, themePreset: null })}
              options={[
                { value: 'sharp' as const, label: d.radiusSharp },
                { value: 'soft' as const, label: d.radiusSoft },
                { value: 'round' as const, label: d.radiusRound },
              ]}
              ariaLabel={d.radius}
            />
          </InlineField>
          <InlineField label={d.buttonStyle}>
            <SegmentedToggle
              value={design.buttonStyle}
              onChange={(buttonStyle) => onBrandingChange({ buttonStyle, themePreset: null })}
              options={[
                { value: 'solid' as const, label: d.buttonSolid },
                { value: 'outline' as const, label: d.buttonOutline },
                { value: 'soft' as const, label: d.buttonSoft },
              ]}
              ariaLabel={d.buttonStyle}
            />
          </InlineField>
          <InlineField label={d.buttonFullWidth}>
            <Switch
              checked={design.buttonFullWidth}
              onCheckedChange={(buttonFullWidth) => onBrandingChange({ buttonFullWidth })}
              aria-label={d.buttonFullWidth}
            />
          </InlineField>
          <InlineField label={d.progress}>
            <SegmentedToggle
              value={design.progressStyle}
              onChange={(progressStyle) => onBrandingChange({ progressStyle })}
              options={[
                { value: 'bar' as const, label: d.progressBar },
                { value: 'dots' as const, label: d.progressDots },
                { value: 'steps' as const, label: d.progressSteps },
                { value: 'none' as const, label: d.progressNone },
              ]}
              ariaLabel={d.progress}
            />
          </InlineField>
        </PanelSection>

        <PanelSection title={d.layoutTitle} subtitle={d.layoutSubtitle}>
          <Field label={m.cover.logo} hint={m.cover.logoHint}>
            <TextField
              value={config.cover?.logo ?? ''}
              placeholder="https://…"
              onChange={(e) => onCoverChange({ logo: e.target.value || null })}
            />
          </Field>
          {config.cover?.logo && !isSafeImageUrl(config.cover.logo) ? (
            <p className="text-xs text-destructive" role="alert">
              {m.cover.logoInvalid}
            </p>
          ) : null}
          <InlineField label={d.logoSize}>
            <SegmentedToggle
              value={design.logoSize}
              onChange={(logoSize) => onBrandingChange({ logoSize })}
              options={[
                { value: 'sm' as const, label: d.sizeSm },
                { value: 'md' as const, label: d.sizeMd },
                { value: 'lg' as const, label: d.sizeLg },
              ]}
              ariaLabel={d.logoSize}
            />
          </InlineField>
          <InlineField label={d.logoPosition}>
            <SegmentedToggle
              value={design.logoPosition}
              onChange={(logoPosition) => onBrandingChange({ logoPosition })}
              options={[
                { value: 'left' as const, label: d.alignLeft },
                { value: 'center' as const, label: d.alignCenter },
              ]}
              ariaLabel={d.logoPosition}
            />
          </InlineField>
          <InlineField label={d.contentAlign}>
            <SegmentedToggle
              value={design.contentAlign}
              onChange={(contentAlign) => onBrandingChange({ contentAlign })}
              options={[
                { value: 'left' as const, label: d.alignLeft },
                { value: 'center' as const, label: d.alignCenter },
              ]}
              ariaLabel={d.contentAlign}
            />
          </InlineField>
          <InlineField label={d.contentWidth}>
            <SegmentedToggle
              value={design.contentWidth}
              onChange={(contentWidth) => onBrandingChange({ contentWidth })}
              options={[
                { value: 'narrow' as const, label: d.widthNarrow },
                { value: 'wide' as const, label: d.widthWide },
              ]}
              ariaLabel={d.contentWidth}
            />
          </InlineField>
          <InlineField label={d.transition}>
            <SegmentedToggle
              value={design.transition}
              onChange={(transition) => onBrandingChange({ transition })}
              options={[
                { value: 'slide' as const, label: d.transitionSlide },
                { value: 'fade' as const, label: d.transitionFade },
                { value: 'none' as const, label: d.transitionNone },
              ]}
              ariaLabel={d.transition}
            />
          </InlineField>
        </PanelSection>

        <PanelSection title={d.shareTitle} subtitle={d.shareSubtitle}>
          <SharePreview config={config} name={name} publicPath={publicPath} />
          <Field label={d.ogImage} hint={d.ogImageHint}>
            <TextField
              value={branding.ogImage ?? ''}
              placeholder="https://…"
              onChange={(e) => onBrandingChange({ ogImage: e.target.value || null })}
            />
          </Field>
          {!branding.ogImage ? <p className="text-xs text-muted-foreground">{d.ogFallback}</p> : null}
        </PanelSection>

        <CoverSection config={config} onCoverChange={onCoverChange} m={m} />
        <ClientLogosSection config={config} onCoverChange={onCoverChange} m={m} />
        {children}
      </div>

      {/* ── Preview ────────────────────────────────────────────────────── */}
      <div className="min-w-0 lg:sticky lg:top-0 lg:h-full lg:min-h-0">
        <PreviewFrame
          device={device}
          onDeviceChange={setDevice}
          publicPath={publicPath}
          m={m.preview}
          toolbar={
            <div className="flex min-w-0 items-center gap-1.5">
              <label htmlFor="design-preview-screen" className="sr-only">
                {m.preview.title}
              </label>
              <select
                id="design-preview-screen"
                value={String(screen)}
                onChange={(e) => setScreen(e.target.value === 'cover' ? 'cover' : Number(e.target.value))}
                data-testid="preview-screen"
                className="h-7 max-w-[13rem] truncate rounded-md border border-input bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {screens.map((s) => (
                  <option key={String(s.value)} value={String(s.value)}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          }
        >
          <LivePreview config={config} selected={screen} name={name} locale={locale} m={m.preview} />
        </PreviewFrame>
      </div>
    </div>
  );
}

/** A labelled WCAG readout for one color pair. */
function ContrastRow({
  label,
  a,
  b,
  failLabel,
}: {
  label: string;
  a: string;
  b: string;
  failLabel: string;
}) {
  const ratio = contrastRatio(a, b);
  const grade = contrastGrade(ratio);
  return (
    <div className="flex items-center gap-2 text-xs" data-testid="contrast-row">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={cn(
          'rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold tabular-nums',
          grade === 'fail' ? 'bg-destructive/15 text-destructive' : 'bg-muted text-muted-foreground',
        )}
      >
        {grade === 'fail' ? `${ratio}:1` : `${grade} ${ratio}:1`}
      </span>
      {grade === 'fail' ? <span className="text-destructive">{failLabel}</span> : null}
    </div>
  );
}

/** The cover's copy — writing, not design, so it sits below the visual axes. */
function CoverSection({
  config,
  onCoverChange,
  m,
}: {
  config: FormConfig;
  onCoverChange: (patch: Partial<FormCover>) => void;
  m: EditorMessages;
}) {
  const cover = config.cover ?? {};
  return (
    <PanelSection title={m.cover.title} subtitle={m.cover.subtitle}>
      <InlineField label={m.cover.enabled}>
        <Switch
          checked={cover.enabled !== false}
          onCheckedChange={(v) => onCoverChange({ enabled: v })}
          aria-label={m.cover.enabled}
        />
      </InlineField>
      <Field label={m.cover.bannerText}>
        <TextField
          value={cover.bannerText ?? ''}
          onChange={(e) => onCoverChange({ bannerText: e.target.value || null })}
        />
      </Field>
      {cover.bannerText ? (
        <InlineField label={m.cover.bannerScope}>
          <SegmentedToggle
            value={cover.bannerScope ?? 'form'}
            onChange={(bannerScope) => onCoverChange({ bannerScope })}
            options={[
              { value: 'form' as const, label: m.cover.bannerScopeForm },
              { value: 'cover' as const, label: m.cover.bannerScopeCover },
            ]}
            ariaLabel={m.cover.bannerScope}
          />
        </InlineField>
      ) : null}
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
        <TextField
          value={cover.subheadline ?? ''}
          onChange={(e) => onCoverChange({ subheadline: e.target.value || null })}
        />
      </Field>
      <Field label={m.cover.ctaText}>
        <TextField value={cover.ctaText ?? ''} onChange={(e) => onCoverChange({ ctaText: e.target.value || null })} />
      </Field>
      <Field label={m.cover.trustBadge}>
        <TextField
          value={cover.trustBadge ?? ''}
          onChange={(e) => onCoverChange({ trustBadge: e.target.value || null })}
        />
      </Field>
    </PanelSection>
  );
}

/** The schema caps `clientLogos` at 24 entries. */
const MAX_CLIENT_LOGOS = 24;

/**
 * The "trusted by" marquee, now its own section. It used to live inside the
 * cover panel, which put a list of a dozen logo URLs between the headline and
 * the brand color — unrelated work interleaved with the thing you were doing.
 */
function ClientLogosSection({
  config,
  onCoverChange,
  m,
}: {
  config: FormConfig;
  onCoverChange: (patch: Partial<FormCover>) => void;
  m: EditorMessages;
}) {
  const cover = config.cover ?? {};
  const logos = cover.clientLogos ?? [];

  function update(index: number, patch: Partial<(typeof logos)[number]>) {
    onCoverChange({ clientLogos: logos.map((l, i) => (i === index ? { ...l, ...patch } : l)) });
  }

  return (
    <PanelSection title={m.cover.clientLogos} subtitle={m.cover.clientLogosHint}>
      <InlineField label={m.cover.showClientLogos}>
        <Switch
          checked={cover.showClientLogos !== false}
          onCheckedChange={(v) => onCoverChange({ showClientLogos: v })}
          aria-label={m.cover.showClientLogos}
        />
      </InlineField>
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
                <button
                  type="button"
                  aria-label={m.cover.removeClientLogo}
                  onClick={() => onCoverChange({ clientLogos: logos.filter((_, li) => li !== i) })}
                  className="mb-0.5 shrink-0 rounded p-2 text-muted-foreground transition-colors hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <i aria-hidden className="pi pi-trash" style={{ fontSize: 13 }} />
                </button>
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
          <button
            type="button"
            disabled={logos.length >= MAX_CLIENT_LOGOS}
            onClick={() => onCoverChange({ clientLogos: [...logos, { name: `Logo ${logos.length + 1}` }] })}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium transition-colors hover:bg-accent disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <i aria-hidden className="pi pi-plus" style={{ fontSize: 11 }} /> {m.cover.addClientLogo}
          </button>
        </div>
      </div>
    </PanelSection>
  );
}

/**
 * The social card as a chat client draws it. Authors never see this surface
 * while building — they see it once, in a Slack message, after the link is out.
 */
function SharePreview({
  config,
  name,
  publicPath,
}: {
  config: FormConfig;
  name: string;
  publicPath: string;
}) {
  const branding = config.branding ?? {};
  const image = branding.ogImage?.trim() || null;
  const headline = config.cover?.headline ?? name;
  const ground = branding.background?.trim() || DEFAULT_CANVAS;
  const accent = clampAccent(branding.primaryColor || '#cbe84f', ground);

  return (
    <div className="max-w-sm overflow-hidden rounded-lg border border-border bg-card">
      <div
        className={cn('flex h-[132px] items-center justify-center overflow-hidden')}
        style={{ background: ground, color: branding.foreground || readableOn(ground) }}
      >
        {image && isSafeImageUrl(image) ? (
          <img src={image} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex flex-col items-center gap-2 px-6 text-center">
            <span className="h-1 w-10 rounded-full" style={{ background: accent }} />
            <span className="line-clamp-2 text-sm font-semibold leading-tight">{headline}</span>
          </div>
        )}
      </div>
      <div className="flex flex-col gap-0.5 px-3 py-2">
        <span className="truncate text-[11px] uppercase tracking-wide text-muted-foreground">
          {publicPath.split('/')[1] ?? ''}
        </span>
        <span className="truncate text-xs font-medium">{headline}</span>
      </div>
    </div>
  );
}
