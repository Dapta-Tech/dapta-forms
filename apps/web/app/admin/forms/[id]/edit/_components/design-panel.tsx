'use client';

import { useState } from 'react';
import type { FormBranding, FormConfig, FormCover, FormLayout } from '@quill/engine';
import {
  DEFAULT_FORM_FONT,
  FORM_BACKGROUND_STYLES,
  isSafeImageUrl,
  resolveDesign,
  resolveFormLogos,
  publicTitle,
} from '@quill/engine';
import {
  AA_CONTRAST,
  DEFAULT_ACCENT,
  DEFAULT_CANVAS,
  blendHex,
  DEFAULT_CANVAS_FOREGROUND,
  contrastGrade,
  contrastRatio,
  onAccent,
  readableOn,
  suggestReadable,
  t,
} from '@quill/shared';
import { Switch } from '@/components/ui/switch';
import { Field, InlineField, NumberField, PanelSection, SegmentedToggle, TextField } from './fields';
import { ColorPicker } from './color-picker';
import { FontPicker } from './font-picker';
import { ThemePresets } from './theme-presets';
import { PreviewFrame, type PreviewDevice } from './preview-frame';
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
  layout,
  onTitleChange,
  onLayoutChange,
  hasReveal,
  onEndRevealChange,
  onCoverChange,
  onBrandingChange,
  children,
  m,
}: {
  config: FormConfig;
  name: string;
  publicPath: string;
  locale: string;
  /** Slides or one page — the first decision, because it changes what several
   *  controls below even mean. */
  layout: FormLayout;
  /** Set/clear the PUBLIC title (empty = fall back to the dashboard name). */
  onTitleChange: (title: string) => void;
  onLayoutChange: (next: FormLayout) => void;
  /** Vertical's single end-of-form reveal (a form-level fact, not a question). */
  hasReveal: boolean;
  onEndRevealChange: (on: boolean) => void;
  onCoverChange: (patch: Partial<FormCover>) => void;
  onBrandingChange: (patch: Partial<FormBranding>) => void;
  /** Non-design panels that share this tab (flow note, ending) — rendered last. */
  children?: React.ReactNode;
  m: EditorMessages;
}) {
  const [device, setDevice] = useState<PreviewDevice>('desktop');
  // Four axes do nothing on one page, so they are not offered there: the form
  // never changes step (transition), the layout pins questions left
  // (contentAlign), it draws its own answered-count progress bar
  // (progressStyle), and the logo sits in a hero rather than a top bar
  // (logoSize/logoPosition). Offering a control that changes nothing is worse
  // than not having it.
  const vertical = layout === 'vertical';

  const d = m.design;
  const branding = config.branding ?? {};
  const design = resolveDesign(branding);
  const cover = config.cover ?? {};
  // What each surface actually shows right now — the fields below are bound to
  // this, not to the raw stored values, so the panel can never claim a form has
  // no logo while one is rendering.
  const logos = resolveFormLogos(config);

  // The colors every contrast readout is measured against. When the author has
  // not chosen a ground, that is the shared dark canvas the form actually
  // renders on — measuring against white would grade a form nobody will see.
  const ground = branding.background?.trim() || DEFAULT_CANVAS;
  const text = branding.foreground?.trim() || (branding.background ? readableOn(ground) : DEFAULT_CANVAS_FOREGROUND);
  const accent = branding.primaryColor?.trim() || DEFAULT_ACCENT;
  // Suggestions, never substitutions. `suggestReadable` returns null when the
  // pair already reads, so a warning only appears when there is a real problem.
  // Body text is held to AA (4.5:1); the accent to 3:1, the threshold that
  // matters for the large/decorative places it actually appears.
  const textSuggestion = branding.foreground ? suggestReadable(text, ground, AA_CONTRAST) : null;
  const accentSuggestion = branding.primaryColor ? suggestReadable(accent, ground) : null;

  return (
    <div className="grid h-full min-h-0 gap-4 px-4 py-6 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,46%)] lg:overflow-hidden">
      {/* ── Controls ───────────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-col gap-4 lg:overflow-y-auto lg:pr-1">
        <PanelSection title={d.publicTitle} subtitle={d.publicTitleHint}>
          <div className="max-w-[520px]">
            <TextField
              aria-label={d.publicTitle}
              value={config.title ?? ''}
              placeholder={name}
              maxLength={200}
              onChange={(e) => onTitleChange(e.target.value)}
            />
          </div>
        </PanelSection>

        <PanelSection title={m.layout.title} subtitle={m.layout.subtitle}>
          <div className="grid max-w-[520px] grid-cols-2 gap-2" role="radiogroup" aria-label={m.layout.title}>
            {[
              { id: 'slides' as const, label: m.layout.slides, hint: m.layout.slidesHint },
              { id: 'vertical' as const, label: m.layout.vertical, hint: m.layout.verticalHint },
            ].map((opt) => (
              <button
                key={opt.id}
                type="button"
                role="radio"
                aria-checked={layout === opt.id}
                data-testid={`design-layout-${opt.id}`}
                onClick={() => onLayoutChange(opt.id)}
                className={cn(
                  'flex flex-col gap-1 rounded-md border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  layout === opt.id
                    ? 'border-primary-edge bg-primary/10 text-foreground'
                    : 'border-border text-muted-foreground hover:border-muted-foreground hover:text-foreground',
                )}
              >
                <span className="text-sm font-medium">{opt.label}</span>
                <span className="text-xs text-muted-foreground">{opt.hint}</span>
              </button>
            ))}
          </div>
          {/* Vertical's one reveal is a FORM-level fact (it always plays after
              Submit), so its switch lives here — not on a question. */}
          {vertical ? (
            <div className="max-w-[520px] border-t border-border pt-3">
              <InlineField label={m.layout.endReveal} hint={m.layout.endRevealHint}>
                <Switch
                  checked={hasReveal}
                  onCheckedChange={onEndRevealChange}
                  data-testid="design-end-reveal"
                  aria-label={m.layout.endReveal}
                />
              </InlineField>
            </div>
          ) : null}
        </PanelSection>

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
              {/* No `against`: the accent is ONLY ever a fill or a border on the
                  public form — no text is accent-coloured — so the 4.5:1 body
                  threshold does not apply and would flag good brand colors. The
                  warning below holds it to 3:1, the UI-component threshold. */}
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
            {/* Only a solid button puts the label on the accent; outline and
                soft put it on the form ground, which the first row covers. */}
            {design.buttonStyle === 'solid' ? (
              <ContrastRow
                label={d.contrastButton}
                a={onAccent(accent)}
                b={accent}
                failLabel={d.contrastFail}
              />
            ) : null}
          </div>

          {/* The colors render EXACTLY as chosen — nothing is silently corrected,
              because a substituted color reads as a bug. When a pair is risky the
              author gets the number, the reason, and a readable alternative they
              can take or ignore. */}
          {textSuggestion ? (
            <Warning
              text={t(d.contrastFail, {})}
              suggestion={textSuggestion}
              applyLabel={t(d.suggestApply, { color: textSuggestion })}
              onApply={() => onBrandingChange({ foreground: textSuggestion, themePreset: null })}
            />
          ) : null}
          {accentSuggestion ? (
            <Warning
              text={t(d.accentLowContrast, { ratio: String(contrastRatio(accent, ground)) })}
              suggestion={accentSuggestion}
              applyLabel={t(d.suggestApply, { color: accentSuggestion })}
              onApply={() => onBrandingChange({ primaryColor: accentSuggestion, themePreset: null })}
            />
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
          {vertical ? null : (
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
          )}
        </PanelSection>

        <PanelSection title={d.layoutTitle} subtitle={d.layoutSubtitle}>
          {/* TWO logos, each with its own field and each clearable to nothing.
              The form's logo shows the RESOLVED value, so a form carrying a logo
              snapshotted from the workspace brand kit finally displays it here —
              that value used to render on every screen while both this panel and
              the brand-kit page showed an empty box, which made it impossible to
              replace or remove. Emptying either field writes null, which the
              resolver reads as "show nothing" rather than falling back. */}
          <Field label={d.formLogo} hint={d.formLogoHint}>
            <TextField
              value={logos.form ?? ''}
              placeholder="https://…"
              data-testid="design-form-logo"
              onChange={(e) => onBrandingChange({ logo: e.target.value || null })}
            />
          </Field>
          {logos.form && !isSafeImageUrl(logos.form) ? (
            <p className="text-xs text-destructive" role="alert">
              {m.cover.logoInvalid}
            </p>
          ) : null}
          {/* Offering a cover logo on a form with no cover screen would be a
              control that changes nothing — the same rule the axes below follow. */}
          {cover.enabled !== false ? (
            <>
              {/* Bound to the RESOLVED cover logo, like the field above. A form
                  that inherits shows the URL it inherits rather than an empty
                  box, so emptying this field is always the same promise: the
                  cover shows no logo. */}
              <Field label={m.cover.logo} hint={m.cover.logoHint}>
                <TextField
                  value={logos.cover ?? ''}
                  placeholder="https://…"
                  data-testid="design-cover-logo"
                  onChange={(e) => onCoverChange({ logo: e.target.value || null })}
                />
              </Field>
              {logos.cover && !isSafeImageUrl(logos.cover) ? (
                <p className="text-xs text-destructive" role="alert">
                  {m.cover.logoInvalid}
                </p>
              ) : null}
            </>
          ) : null}
          {/* The one-page layout puts the logo in a hero, not a top bar, so
              neither size nor placement applies there. */}
          {vertical ? null : (
            <>
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
            </>
          )}
          {vertical ? null : (
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
          )}
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
          {vertical ? null : (
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
          )}
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

      {/* ── Preview ─────────────────────────────────────────────────────────
          The tab where fidelity matters MOST: this is where colours and
          typefaces get chosen, and until now it was chosen while looking at
          something that lied about mobile — every "mobile" measurement it
          showed was the desktop rendering in a 390px box. It is the same
          `PreviewFrame` the Preview modal uses, so both surfaces are honest or
          neither is. The frame runs the real renderer and walks itself; its
          prev/next only choose which screen the renderer STARTS on. */}
      <div className="min-w-0 lg:sticky lg:top-0 lg:h-full lg:min-h-0">
        <PreviewFrame
          device={device}
          onDeviceChange={setDevice}
          publicPath={publicPath}
          config={config}
          name={name}
          locale={locale}
          layout={layout}
          m={m.preview}
        />
      </div>
    </div>
  );
}

/**
 * A legibility warning with a way out. The colors still render exactly as
 * chosen — this is advice, and taking it is one click rather than the author's
 * job to work out which hex would have passed.
 */
function Warning({
  text,
  suggestion,
  applyLabel,
  onApply,
}: {
  text: string;
  suggestion: string;
  applyLabel: string;
  onApply: () => void;
}) {
  return (
    <div
      role="status"
      data-testid="contrast-warning"
      className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-xs text-foreground"
    >
      <i aria-hidden className="pi pi-exclamation-triangle shrink-0 text-destructive" style={{ fontSize: 11 }} />
      <span className="min-w-0 flex-1">{text}</span>
      <button
        type="button"
        onClick={onApply}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-sm border border-border bg-background px-2 py-0.5 font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span aria-hidden className="h-3 w-3 rounded-sm border border-border" style={{ background: suggestion }} />
        {applyLabel}
      </button>
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
  // 0 means a color the ratio math cannot read — the schema also accepts
  // `rgb()`, `hsl()` and named colors. Saying nothing is honest; showing
  // "fail 0:1" would invent a problem that isn't there.
  if (ratio === 0) return null;
  const grade = contrastGrade(ratio);
  return (
    <div className="flex items-center gap-2 text-xs" data-testid="contrast-row">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={cn(
          'rounded-sm px-1.5 py-0.5 font-mono text-2xs font-semibold tabular-nums',
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
  // What the strip renders when `bannerColor` is unset — `.pf__banner`'s own
  // fallback, 12% of the accent over the form ground. Resolved here so the text
  // colour's contrast readout has a real surface to judge against. The two
  // inputs fall back exactly as the section above resolves them.
  const branding = config.branding ?? {};
  const bannerTint = blendHex(
    branding.background?.trim() || DEFAULT_CANVAS,
    branding.primaryColor?.trim() || DEFAULT_ACCENT,
    0.12,
  );
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
      {/* Everything about the strip's look hangs off there BEING a strip. With
          no text there is no banner on the page, so a color picker for it would
          be a control with nothing to change. */}
      {cover.bannerText ? (
        <>
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
          <Field label={m.cover.bannerColor} hint={m.cover.bannerColorHint}>
            <ColorPicker
              value={cover.bannerColor}
              onChange={(bannerColor) => onCoverChange({ bannerColor })}
              label={m.cover.bannerColor}
              allowEmpty
              m={m.design}
            />
          </Field>
          <Field label={m.cover.bannerTextColor}>
            {/* `against` is the strip's own fill, so the contrast readout judges
                the pair that actually renders — not the text against the form
                ground, which is a different surface entirely.
                It falls back to the DERIVED tint rather than to `undefined`,
                which switches the badge off: the likeliest bad pair is pale text
                on the default 12%-accent wash, so leaving the colour unset was
                exactly the case that got no warning. Mirrors the stylesheet's
                own fallback in `.pf__banner`. */}
            <ColorPicker
              value={cover.bannerTextColor}
              onChange={(bannerTextColor) => onCoverChange({ bannerTextColor })}
              label={m.cover.bannerTextColor}
              against={cover.bannerColor ?? bannerTint}
              againstLabel={m.cover.bannerColor}
              allowEmpty
              m={m.design}
            />
          </Field>
          <InlineField label={m.cover.bannerSize}>
            <SegmentedToggle
              value={cover.bannerSize ?? 'md'}
              onChange={(bannerSize) => onCoverChange({ bannerSize })}
              options={[
                { value: 'sm' as const, label: m.cover.bannerSizeSm },
                { value: 'md' as const, label: m.cover.bannerSizeMd },
                { value: 'lg' as const, label: m.cover.bannerSizeLg },
              ]}
              ariaLabel={m.cover.bannerSize}
            />
          </InlineField>
        </>
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
      {/* Only reachable while the marquee is on: picking WHERE something shows
          is meaningless once it shows nowhere. */}
      {cover.showClientLogos !== false ? (
        <InlineField label={m.cover.clientLogosScope}>
          <SegmentedToggle
            value={cover.clientLogosScope ?? 'cover'}
            onChange={(clientLogosScope) => onCoverChange({ clientLogosScope })}
            options={[
              { value: 'cover' as const, label: m.cover.clientLogosScopeCover },
              { value: 'reveal' as const, label: m.cover.clientLogosScopeReveal },
              { value: 'both' as const, label: m.cover.clientLogosScopeBoth },
            ]}
            ariaLabel={m.cover.clientLogosScope}
          />
        </InlineField>
      ) : null}
      <div className="flex flex-col gap-2">
        {logos.length === 0 ? (
          <p className="text-xs text-muted-foreground">{m.cover.clientLogosEmpty}</p>
        ) : (
          logos.map((logo, i) => (
            <div key={i} className="flex flex-col gap-2 rounded-md border border-border bg-background p-2">
              <div className="flex items-end gap-2">
                <label className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-xs font-medium text-muted-foreground">{m.cover.clientLogoName}</span>
                  <TextField
                    value={logo.name}
                    onChange={(e) => update(i, { name: e.target.value })}
                    className="h-8 py-1 text-xs"
                  />
                </label>
                <label className="flex min-w-0 flex-[2] flex-col gap-1">
                  <span className="text-xs font-medium text-muted-foreground">{m.cover.clientLogoSrc}</span>
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
                  className="mb-0.5 shrink-0 rounded-sm p-2 text-muted-foreground transition-colors hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
  // Same resolution as the real card: cover headline, else the PUBLIC title.
  const headline = config.cover?.headline ?? publicTitle(config, name);
  const ground = branding.background?.trim() || DEFAULT_CANVAS;
  // The author's exact color, like everywhere else — the share card must show
  // the card that will actually be generated, not a corrected version of it.
  const accent = branding.primaryColor?.trim() || DEFAULT_ACCENT;

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
        <span className="truncate text-2xs uppercase tracking-wide text-faint">
          {publicPath.split('/')[1] ?? ''}
        </span>
        <span className="truncate text-xs font-medium">{headline}</span>
      </div>
    </div>
  );
}
