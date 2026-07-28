'use client';

import { useMemo, useState, useTransition } from 'react';
import type { FormBranding, FormButtonStyle, FormFont, FormRadius } from '@quill/engine';
import { DEFAULT_FORM_FONT } from '@quill/engine';
import { DEFAULT_ACCENT, DEFAULT_CANVAS, onAccent, readableOn, t, type FormsMessages } from '@quill/shared';
import type { BrandKit, FormSummary } from '@/lib/admin-api';
import { formDesignProps } from '@/lib/form-design';
import { cn } from '@/lib/cn';
import { Field, PanelSection, SegmentedToggle, TextField } from '../forms/[id]/edit/_components/fields';
import { ColorPicker } from '../forms/[id]/edit/_components/color-picker';
import { FontPicker } from '../forms/[id]/edit/_components/font-picker';
import { applyBrandKitAction, revertBrandKitAction, saveBrandKitAction } from './actions';

type BrandKitMessages = FormsMessages['admin']['brandKit'];
type DesignMessages = FormsMessages['admin']['editor']['design'];

const RADIUS_PX: Record<FormRadius, string> = { sharp: '2px', soft: '10px', round: '999px' };

/**
 * The brand-kit editor + the bulk apply list. All state is local until Save;
 * apply/revert act immediately (they rewrite form configs server-side) and are
 * offered only to admins — `canEdit` mirrors the API's own role check.
 */
export function BrandKitPanel({
  initialKit,
  updatedAt,
  forms,
  canEdit,
  bk,
  design,
  locale,
}: {
  initialKit: BrandKit;
  updatedAt: number | null;
  forms: FormSummary[];
  canEdit: boolean;
  bk: BrandKitMessages;
  design: DesignMessages;
  locale: string;
}) {
  const [kit, setKit] = useState<BrandKit>(initialKit);
  const [savedAt, setSavedAt] = useState<number | null>(updatedAt);
  const [applied, setApplied] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(forms.map((f) => [f.id, f.brandAppliedAt != null])),
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const [applying, startApplying] = useTransition();
  const [revertingId, setRevertingId] = useState<string | null>(null);

  const patch = (p: Partial<BrandKit>) => setKit((k) => ({ ...k, ...p }));

  const flash = (msg: string) => {
    setError(null);
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  };

  const save = () =>
    startSaving(async () => {
      const res = await saveBrandKitAction(kit);
      if (res.ok) {
        setSavedAt(res.value.updatedAt);
        flash(bk.saved);
      } else setError(res.message ?? bk.saved);
    });

  const apply = () => {
    const ids = [...selected];
    if (!ids.length) return;
    startApplying(async () => {
      const res = await applyBrandKitAction(ids);
      if (res.ok) {
        setApplied((a) => ({ ...a, ...Object.fromEntries(res.value.applied.map((id) => [id, true])) }));
        setSelected(new Set());
        flash(t(bk.appliedToast, { count: String(res.value.applied.length) }));
      } else setError(res.message ?? null);
    });
  };

  const revert = async (id: string) => {
    setRevertingId(id);
    try {
      const res = await revertBrandKitAction([id]);
      if (res.ok && res.value.reverted.includes(id)) {
        setApplied((a) => ({ ...a, [id]: false }));
        flash(bk.revertedToast);
      } else if (!res.ok) setError(res.message ?? null);
    } finally {
      setRevertingId(null);
    }
  };

  // Preview ground: the kit's own colors, falling back to the shared dark
  // canvas the public form actually renders on when the kit sets none.
  const ground = kit.background?.trim() || DEFAULT_CANVAS;
  const text = kit.foreground?.trim() || readableOn(ground);
  const accent = kit.primaryColor?.trim() || DEFAULT_ACCENT;
  const radius = RADIUS_PX[kit.radius ?? 'soft'];
  const buttonStyle = kit.buttonStyle ?? 'solid';
  // The kit is a structural subset of a form's branding, which is exactly why
  // the same design resolver can preview it.
  const previewProps = useMemo(() => formDesignProps(kit as FormBranding), [kit]);

  const clientLogos = kit.clientLogos ?? [];
  const disabled = !canEdit;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,40%)]">
      <div className="flex min-w-0 flex-col gap-4">
        {!canEdit ? (
          <p className="rounded-md border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
            {bk.adminOnly}
          </p>
        ) : null}

        <PanelSection title={bk.logoTitle} subtitle={bk.logoSubtitle}>
          <Field label={bk.logoUrl}>
            <TextField
              value={kit.logo ?? ''}
              placeholder={bk.logoUrlPlaceholder}
              disabled={disabled}
              onChange={(e) => patch({ logo: e.target.value.trim() || null })}
              data-testid="brand-logo-url"
            />
          </Field>
        </PanelSection>

        <PanelSection title={bk.clientLogosTitle} subtitle={bk.clientLogosSubtitle}>
          <div className="flex flex-col gap-2">
            {clientLogos.map((logo, i) => (
              <div key={i} className="flex items-center gap-2">
                <TextField
                  value={logo.name}
                  placeholder={bk.clientLogoNamePlaceholder}
                  disabled={disabled}
                  onChange={(e) => {
                    const next = [...clientLogos];
                    next[i] = { ...logo, name: e.target.value };
                    patch({ clientLogos: next });
                  }}
                />
                <TextField
                  value={logo.src ?? ''}
                  placeholder={bk.clientLogoUrlPlaceholder}
                  disabled={disabled}
                  onChange={(e) => {
                    const next = [...clientLogos];
                    next[i] = { ...logo, src: e.target.value.trim() || null };
                    patch({ clientLogos: next });
                  }}
                />
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => patch({ clientLogos: clientLogos.filter((_, j) => j !== i) })}
                  className="shrink-0 rounded-md border border-border px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:border-destructive hover:text-destructive"
                >
                  {bk.clientLogosRemove}
                </button>
              </div>
            ))}
            <button
              type="button"
              disabled={disabled || clientLogos.length >= 24}
              onClick={() => patch({ clientLogos: [...clientLogos, { name: '' }] })}
              className="self-start rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary"
              data-testid="brand-client-logo-add"
            >
              {bk.clientLogosAdd}
            </button>
          </div>
        </PanelSection>

        <PanelSection title={bk.colorsTitle} subtitle={bk.colorsSubtitle}>
          <div className="grid max-w-[520px] grid-cols-1 gap-3 sm:grid-cols-3">
            <ColorPicker
              label={design.background}
              value={kit.background}
              allowEmpty
              onChange={(background) => patch({ background })}
              m={design}
            />
            <ColorPicker
              label={design.foreground}
              value={kit.foreground}
              against={ground}
              againstLabel={design.contrastText}
              allowEmpty
              onChange={(foreground) => patch({ foreground })}
              m={design}
            />
            <ColorPicker
              label={design.accent}
              value={kit.primaryColor}
              against={ground}
              againstLabel={design.contrastButton}
              allowEmpty
              onChange={(primaryColor) => patch({ primaryColor })}
              m={design}
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{design.themeLockHint}</p>
        </PanelSection>

        <PanelSection title={bk.typographyTitle} subtitle={bk.typographySubtitle}>
          <div className="flex max-w-[520px] flex-col gap-3">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <FontPicker
                  value={kit.fontFamily ?? DEFAULT_FORM_FONT}
                  onChange={(fontFamily: FormFont) => patch({ fontFamily })}
                  m={design}
                />
              </div>
              {kit.fontFamily ? (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => patch({ fontFamily: undefined, customFont: undefined })}
                  className="shrink-0 text-xs text-muted-foreground underline-offset-2 hover:underline"
                >
                  {bk.clearAxis}
                </button>
              ) : (
                <span className="shrink-0 text-xs text-muted-foreground">{bk.notSet}</span>
              )}
            </div>
            {kit.fontFamily === 'custom' ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label={design.customFontName}>
                  <TextField
                    value={kit.customFont?.name ?? ''}
                    placeholder={design.customFontNamePlaceholder}
                    disabled={disabled}
                    onChange={(e) =>
                      patch({ customFont: { name: e.target.value, url: kit.customFont?.url ?? '' } })
                    }
                  />
                </Field>
                <Field label={design.customFontUrl} hint={design.customFontHint}>
                  <TextField
                    value={kit.customFont?.url ?? ''}
                    disabled={disabled}
                    onChange={(e) =>
                      patch({ customFont: { name: kit.customFont?.name ?? '', url: e.target.value } })
                    }
                  />
                </Field>
              </div>
            ) : null}
          </div>
        </PanelSection>

        <PanelSection title={bk.controlsTitle} subtitle={bk.controlsSubtitle}>
          <div className="flex flex-col gap-3">
            <Field label={design.radius}>
              <div className="flex items-center gap-2">
                <SegmentedToggle
                  value={kit.radius ?? ('unset' as unknown as FormRadius)}
                  onChange={(radius) => patch({ radius })}
                  options={[
                    { value: 'sharp', label: design.radiusSharp },
                    { value: 'soft', label: design.radiusSoft },
                    { value: 'round', label: design.radiusRound },
                  ]}
                  ariaLabel={design.radius}
                />
                {kit.radius ? (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => patch({ radius: undefined })}
                    className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                  >
                    {bk.clearAxis}
                  </button>
                ) : (
                  <span className="text-xs text-muted-foreground">{bk.notSet}</span>
                )}
              </div>
            </Field>
            <Field label={design.buttonStyle}>
              <div className="flex items-center gap-2">
                <SegmentedToggle
                  value={kit.buttonStyle ?? ('unset' as unknown as FormButtonStyle)}
                  onChange={(buttonStyle) => patch({ buttonStyle })}
                  options={[
                    { value: 'solid', label: design.buttonSolid },
                    { value: 'outline', label: design.buttonOutline },
                    { value: 'soft', label: design.buttonSoft },
                  ]}
                  ariaLabel={design.buttonStyle}
                />
                {kit.buttonStyle ? (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => patch({ buttonStyle: undefined })}
                    className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                  >
                    {bk.clearAxis}
                  </button>
                ) : (
                  <span className="text-xs text-muted-foreground">{bk.notSet}</span>
                )}
              </div>
            </Field>
          </div>
        </PanelSection>

        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={disabled || saving}
            onClick={save}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity disabled:opacity-50"
            data-testid="brand-save"
          >
            {saving ? bk.saving : bk.save}
          </button>
          {savedAt ? (
            <span className="text-xs text-muted-foreground">
              {t(bk.updatedAt, { date: new Date(savedAt).toLocaleString(locale) })}
            </span>
          ) : null}
          {toast ? <span className="text-sm text-primary">{toast}</span> : null}
          {error ? <span className="text-sm text-destructive">{error}</span> : null}
        </div>

        <PanelSection title={bk.applyTitle} subtitle={bk.applySubtitle}>
          {forms.length === 0 ? (
            <p className="text-sm text-muted-foreground">{bk.emptyForms}</p>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-xs text-muted-foreground">{bk.applyWarning}</p>
              <div className="flex items-center gap-3 text-xs">
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => setSelected(new Set(forms.map((f) => f.id)))}
                  className="text-muted-foreground underline-offset-2 hover:underline"
                >
                  {bk.applySelectAll}
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => setSelected(new Set())}
                  className="text-muted-foreground underline-offset-2 hover:underline"
                >
                  {bk.applyClear}
                </button>
              </div>
              <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
                {forms.map((f) => (
                  <li key={f.id} className="flex items-center gap-3 px-3 py-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[var(--primary,#cbe84f)]"
                      checked={selected.has(f.id)}
                      disabled={disabled}
                      onChange={(e) => {
                        const next = new Set(selected);
                        if (e.target.checked) next.add(f.id);
                        else next.delete(f.id);
                        setSelected(next);
                      }}
                      aria-label={f.name}
                    />
                    <span className="min-w-0 flex-1 truncate text-sm">{f.name}</span>
                    {applied[f.id] ? (
                      <>
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                          {bk.appliedBadge}
                        </span>
                        <button
                          type="button"
                          disabled={disabled || revertingId === f.id}
                          onClick={() => revert(f.id)}
                          className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                          data-testid={`brand-revert-${f.id}`}
                        >
                          {revertingId === f.id ? bk.reverting : bk.revert}
                        </button>
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                disabled={disabled || applying || selected.size === 0}
                onClick={apply}
                className="self-start rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity disabled:opacity-50"
                data-testid="brand-apply"
              >
                {applying ? bk.applying : t(bk.applyButton, { count: String(selected.size) })}
              </button>
            </div>
          )}
        </PanelSection>
      </div>

      {/* ── Preview ─────────────────────────────────────────────────────── */}
      <div className="lg:sticky lg:top-6 lg:self-start">
        <PanelSection title={bk.previewTitle} subtitle="">
          {previewProps.fontFace ? <style dangerouslySetInnerHTML={{ __html: previewProps.fontFace }} /> : null}
          <div
            style={{ ...previewProps.style, background: ground, color: text, fontFamily: 'var(--pf-font)' }}
            className="flex flex-col gap-4 rounded-lg border border-border p-6"
          >
            {kit.logo ? (
              <img src={kit.logo} alt="" className="h-8 w-auto self-start object-contain" />
            ) : null}
            <p className="text-lg font-semibold">{bk.previewQuestion}</p>
            <div
              style={{ borderRadius: radius, borderColor: `color-mix(in srgb, ${text} 25%, ${ground})` }}
              className="border px-3 py-2 text-sm opacity-70"
            >
              you@example.com
            </div>
            <button
              type="button"
              tabIndex={-1}
              style={{
                borderRadius: radius,
                ...(buttonStyle === 'solid'
                  ? { background: accent, color: onAccent(accent) }
                  : buttonStyle === 'outline'
                    ? { background: 'transparent', color: accent, border: `1.5px solid ${accent}` }
                    : { background: `color-mix(in srgb, ${accent} 18%, transparent)`, color: accent }),
              }}
              className="self-start px-5 py-2 text-sm font-medium"
            >
              {bk.previewButton}
            </button>
            {clientLogos.length ? (
              <div className="mt-2 flex flex-wrap items-center gap-3 opacity-60">
                {clientLogos.slice(0, 6).map((l, i) =>
                  l.src ? (
                    <img key={i} src={l.src} alt={l.name} className="h-5 w-auto object-contain" />
                  ) : (
                    <span key={i} className={cn('text-xs', !l.name && 'hidden')}>
                      {l.name}
                    </span>
                  ),
                )}
              </div>
            ) : null}
          </div>
        </PanelSection>
      </div>
    </div>
  );
}
