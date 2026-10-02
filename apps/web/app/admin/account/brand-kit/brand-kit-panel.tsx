'use client';

import { useMemo, useState, useTransition, type ReactNode } from 'react';
import type { FormBranding, FormButtonStyle, FormFont, FormRadius } from '@quill/engine';
import { DEFAULT_FORM_FONT, NEW_FORM_PRESET_ID, findThemePreset } from '@quill/engine';
import {
  DEFAULT_CANVAS,
  DEFAULT_CANVAS_FOREGROUND,
  formatDateTime,
  onAccent,
  readableOn,
  t,
  type FormsMessages,
} from '@quill/shared';
import { useWorkspaceTimeZone } from '@/components/workspace-timezone';
import type { BrandKit, FormSummary } from '@/lib/admin-api';
import { formDesignProps } from '@/lib/form-design';
import { callAction, isTransportError } from '@/lib/call-action';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { SettingsPanel, SettingsRow } from '@/components/ui/settings';
import { Field, SegmentedToggle, TextField } from '@/app/admin/forms/[id]/edit/_components/fields';
import { ColorPicker } from '@/app/admin/forms/[id]/edit/_components/color-picker';
import { FontPicker } from '@/app/admin/forms/[id]/edit/_components/font-picker';
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
  workspaceName,
  heading,
}: {
  initialKit: BrandKit;
  updatedAt: number | null;
  forms: FormSummary[];
  canEdit: boolean;
  bk: BrandKitMessages;
  design: DesignMessages;
  locale: string;
  /** For the tile that stands in for the logo until one is set. */
  workspaceName: string;
  /** The screen's title block, set beside the Save button it shares a row with. */
  heading: ReactNode;
}) {
  const timeZone = useWorkspaceTimeZone();
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
      const res = await callAction(() => saveBrandKitAction(kit));
      if (res.ok) {
        setSavedAt(res.value.updatedAt);
        flash(bk.saved);
      } else setError(isTransportError(res) ? bk.saveOffline : (res.message ?? bk.saved));
    });

  const apply = () => {
    const ids = [...selected];
    if (!ids.length) return;
    startApplying(async () => {
      const res = await callAction(() => applyBrandKitAction(ids));
      if (isTransportError(res)) {
        setError(bk.saveOffline);
        return;
      }
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
      const res = await callAction(() => revertBrandKitAction([id]));
      if (isTransportError(res)) {
        setError(bk.saveOffline);
        return;
      }
      if (res.ok && res.value.reverted.includes(id)) {
        setApplied((a) => ({ ...a, [id]: false }));
        flash(bk.revertedToast);
      } else if (!res.ok) setError(res.message ?? null);
    } finally {
      setRevertingId(null);
    }
  };

  // Preview: what a NEW form born with this kit looks like. Colours the kit
  // leaves out are filled the way a new form is (`withNewFormBranding`): white,
  // ink and Signal Green. The one exception mirrors that rule: a kit that sets a
  // text colour or a background but not both keeps the old dark ground, because
  // pairing its half with a white one could put white text on white.
  const house = findThemePreset(NEW_FORM_PRESET_ID);
  const bg = kit.background?.trim() || '';
  const fg = kit.foreground?.trim() || '';
  const stampsGround = !bg && !fg;
  const ground = bg || (stampsGround ? (house?.background ?? DEFAULT_CANVAS) : DEFAULT_CANVAS);
  const text =
    fg || (bg ? readableOn(ground) : stampsGround ? (house?.foreground ?? DEFAULT_CANVAS_FOREGROUND) : DEFAULT_CANVAS_FOREGROUND);
  const accent = kit.primaryColor?.trim() || house?.primaryColor || '#3ddc84';
  const radius = RADIUS_PX[kit.radius ?? 'soft'];
  const buttonStyle = kit.buttonStyle ?? 'solid';
  // The kit is a structural subset of a form's branding, which is exactly why
  // the same design resolver can preview it.
  const previewProps = useMemo(() => formDesignProps(kit as FormBranding), [kit]);

  const clientLogos = kit.clientLogos ?? [];
  const disabled = !canEdit;

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_21rem] xl:items-start">
      <div className="min-w-0">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 pb-6">
          <div className="min-w-0 flex-1">{heading}</div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <Button type="button" disabled={disabled || saving} onClick={save} data-testid="brand-save">
              {saving ? bk.saving : bk.save}
            </Button>
            {savedAt ? (
              <span className="text-xs text-muted-foreground">
                {t(bk.updatedAt, { date: formatDateTime(savedAt, { locale, timeZone }) })}
              </span>
            ) : null}
            {toast ? <span className="text-xs font-medium text-foreground">{toast}</span> : null}
            {error ? <span className="text-xs text-destructive">{error}</span> : null}
          </div>
        </div>

        {!canEdit ? (
          <p className="mb-2 rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
            {bk.adminOnly}
          </p>
        ) : null}

        <div className="border-t border-border">
          <SettingsRow title={bk.logoTitle} hint={bk.logoSubtitle} first>
            <div className="flex items-center gap-3">
              <span
                aria-hidden
                className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-primary text-xl font-semibold text-primary-foreground"
              >
                {kit.logo ? (
                  <img src={kit.logo} alt="" className="h-full w-full bg-card object-contain p-1.5" />
                ) : (
                  (workspaceName.trim().charAt(0) || '?').toUpperCase()
                )}
              </span>
              <TextField
                value={kit.logo ?? ''}
                placeholder={bk.logoUrlPlaceholder}
                disabled={disabled}
                aria-label={bk.logoUrl}
                onChange={(e) => patch({ logo: e.target.value.trim() || null })}
                data-testid="brand-logo-url"
              />
            </div>
          </SettingsRow>

          <SettingsRow title={bk.clientLogosTitle} hint={bk.clientLogosSubtitle}>
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
                    className="shrink-0 rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-destructive hover:text-destructive"
                  >
                    {bk.clientLogosRemove}
                  </button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled || clientLogos.length >= 24}
                onClick={() => patch({ clientLogos: [...clientLogos, { name: '' }] })}
                className="self-start"
                data-testid="brand-client-logo-add"
              >
                {bk.clientLogosAdd}
              </Button>
            </div>
          </SettingsRow>

          <SettingsRow title={bk.colorsTitle} hint={bk.colorsSubtitle}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <ColorPicker
                variant="card"
                label={design.background}
                emptyLabel={bk.notSetShort}
                value={kit.background}
                allowEmpty
                disabled={disabled}
                onChange={(background) => patch({ background })}
                m={design}
              />
              <ColorPicker
                variant="card"
                label={design.foreground}
                emptyLabel={bk.notSetShort}
                value={kit.foreground}
                against={ground}
                againstLabel={design.contrastText}
                allowEmpty
                disabled={disabled}
                onChange={(foreground) => patch({ foreground })}
                m={design}
              />
              <ColorPicker
                variant="card"
                label={design.accent}
                emptyLabel={bk.notSetShort}
                value={kit.primaryColor}
                against={ground}
                againstLabel={design.contrastButton}
                allowEmpty
                disabled={disabled}
                onChange={(primaryColor) => patch({ primaryColor })}
                m={design}
              />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">{design.themeLockHint}</p>
          </SettingsRow>

          <SettingsRow title={bk.typographyTitle} hint={bk.typographySubtitle}>
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <FontPicker
                    value={kit.fontFamily ?? DEFAULT_FORM_FONT}
                    disabled={disabled}
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
                  <span className="shrink-0 text-xs text-muted-foreground" title={bk.notSet}>
                    {bk.notSetShort}
                  </span>
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
          </SettingsRow>

          <SettingsRow title={bk.controlsTitle} hint={bk.controlsSubtitle}>
            <div className="flex flex-col gap-5">
              <Field label={design.radius}>
                <div className="flex items-center gap-3">
                  <SegmentedToggle
                    value={kit.radius ?? ('unset' as unknown as FormRadius)}
                    onChange={(radius) => patch({ radius })}
                    options={[
                      { value: 'sharp', label: design.radiusSharp },
                      { value: 'soft', label: design.radiusSoft },
                      { value: 'round', label: design.radiusRound },
                    ]}
                    ariaLabel={design.radius}
                    disabled={disabled}
                    className="min-w-0 flex-1"
                  />
                  {kit.radius ? (
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => patch({ radius: undefined })}
                      className="shrink-0 text-xs text-muted-foreground underline-offset-2 hover:underline"
                    >
                      {bk.clearAxis}
                    </button>
                  ) : (
                    <span className="shrink-0 text-xs text-muted-foreground">{bk.notSetShort}</span>
                  )}
                </div>
              </Field>
              <Field label={design.buttonStyle}>
                <div className="flex items-center gap-3">
                  <SegmentedToggle
                    value={kit.buttonStyle ?? ('unset' as unknown as FormButtonStyle)}
                    onChange={(buttonStyle) => patch({ buttonStyle })}
                    options={[
                      { value: 'solid', label: design.buttonSolid },
                      { value: 'outline', label: design.buttonOutline },
                      { value: 'soft', label: design.buttonSoft },
                    ]}
                    ariaLabel={design.buttonStyle}
                    disabled={disabled}
                    className="min-w-0 flex-1"
                  />
                  {kit.buttonStyle ? (
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => patch({ buttonStyle: undefined })}
                      className="shrink-0 text-xs text-muted-foreground underline-offset-2 hover:underline"
                    >
                      {bk.clearAxis}
                    </button>
                  ) : (
                    <span className="shrink-0 text-xs text-muted-foreground">{bk.notSetShort}</span>
                  )}
                </div>
              </Field>
            </div>
          </SettingsRow>
        </div>
      </div>

      {/* ── Beside the settings: what they make, and what to do with it ─────── */}
      <div className="flex min-w-0 flex-col gap-4 xl:sticky xl:top-6">
        <SettingsPanel title={bk.previewTitle} tone="well">
          {previewProps.fontFace ? <style dangerouslySetInnerHTML={{ __html: previewProps.fontFace }} /> : null}
          <div
            style={{ ...previewProps.style, background: ground, color: text, fontFamily: 'var(--pf-font)' }}
            className="flex flex-col gap-4 rounded-xl border border-border p-5"
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
        </SettingsPanel>

        <SettingsPanel title={bk.applyTitle} hint={bk.applySubtitle}>
          {forms.length === 0 ? (
            <p className="text-sm text-muted-foreground">{bk.emptyForms}</p>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3 text-xs">
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => setSelected(new Set(forms.map((f) => f.id)))}
                  className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                >
                  {bk.applySelectAll}
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => setSelected(new Set())}
                  className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                >
                  {bk.applyClear}
                </button>
              </div>
              <ul className="flex flex-col divide-y divide-border border-y border-border">
                {forms.map((f) => (
                  <li key={f.id} className="flex items-center gap-3 py-2.5">
                    <Checkbox
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
                        <span className="shrink-0 rounded-full bg-signal/20 px-2 py-0.5 text-xs font-medium text-foreground">
                          {bk.appliedBadge}
                        </span>
                        <button
                          type="button"
                          disabled={disabled || revertingId === f.id}
                          onClick={() => revert(f.id)}
                          className="shrink-0 text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                          data-testid={`brand-revert-${f.id}`}
                        >
                          {revertingId === f.id ? bk.reverting : bk.revert}
                        </button>
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
              <p className="flex items-start gap-2 rounded-lg bg-warning/15 p-3 text-xs text-foreground">
                <span aria-hidden className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-warning" />
                {bk.applyWarning}
              </p>
              <Button
                type="button"
                variant="soft"
                disabled={disabled || applying || selected.size === 0}
                onClick={apply}
                data-testid="brand-apply"
              >
                {applying ? bk.applying : t(bk.applyButton, { count: String(selected.size) })}
              </Button>
            </div>
          )}
        </SettingsPanel>
      </div>
    </div>
  );
}
