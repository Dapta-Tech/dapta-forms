'use client';

import {
  DEFAULT_FORM_FONT,
  FORM_THEME_PRESETS,
  LEGACY_FORM_DESIGN,
  type FormBranding,
  type FormThemePreset,
} from '@quill/engine';
import { formFontStack } from '@/lib/fonts';
import { cn } from '@/lib/cn';
import type { EditorMessages } from './messages';

/** The branding patch a preset applies. Exported so the panel can reuse it. */
export function presetPatch(preset: FormThemePreset): Partial<FormBranding> {
  return {
    background: preset.background,
    foreground: preset.foreground,
    primaryColor: preset.primaryColor,
    fontFamily: preset.font,
    radius: preset.radius,
    buttonStyle: preset.buttonStyle,
    themePreset: preset.id,
  };
}

const RADIUS_PX: Record<FormThemePreset['radius'], number> = { sharp: 2, soft: 8, round: 14 };

/**
 * Theme presets — the fastest path from "the default look" to something an
 * author is willing to publish.
 *
 * A preset WRITES its values into the individual fields rather than being a
 * mode the renderer reads. So the moment one is applied everything below stays
 * editable, and hand-editing any axis simply drops the selection back to
 * Custom. Nothing at render time ever reads `themePreset`.
 *
 * Each card is a real miniature built from the preset's own colors, font and
 * radius, because a row of named swatches does not tell you what the form will
 * feel like.
 */
export function ThemePresets({
  branding,
  onApply,
  m,
}: {
  branding: FormBranding | null | undefined;
  onApply: (patch: Partial<FormBranding>) => void;
  m: EditorMessages['design'];
}) {
  // Selection is derived from the COLORS, not from the stored id: an author who
  // applies Ocean and then changes the accent is no longer on Ocean, and the
  // card must stop claiming they are.
  const active = FORM_THEME_PRESETS.find(
    (p) =>
      p.background === branding?.background &&
      p.foreground === branding?.foreground &&
      p.primaryColor === branding?.primaryColor &&
      // The absent-value defaults come from the engine's design table rather than
      // being spelled out here: they were literals ('poppins' / 'soft') and went
      // stale the moment the brand's default face and corner changed, which
      // silently stopped the default preset's card from ever reading as selected.
      p.font === (branding?.fontFamily ?? DEFAULT_FORM_FONT) &&
      p.radius === (branding?.radius ?? LEGACY_FORM_DESIGN.radius),
  );

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {FORM_THEME_PRESETS.map((p) => {
        const selected = active?.id === p.id;
        return (
          <button
            key={p.id}
            type="button"
            aria-pressed={selected}
            onClick={() => onApply(presetPatch(p))}
            data-testid={`theme-preset-${p.id}`}
            className={cn(
              'group flex flex-col gap-1.5 rounded-lg border p-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              selected ? 'border-primary' : 'border-border hover:border-muted-foreground',
            )}
          >
            <span
              aria-hidden
              className="flex flex-col gap-1.5 overflow-hidden p-2.5"
              style={{
                background: p.background,
                color: p.foreground,
                borderRadius: RADIUS_PX[p.radius],
                fontFamily: formFontStack(p.font),
              }}
            >
              <span className="text-[11px] font-semibold leading-tight">Aa</span>
              <span className="h-1 w-full rounded-full" style={{ background: `${p.primaryColor}` }} />
              <span
                className="mt-0.5 inline-block px-2 py-1 text-center text-[9px] font-semibold"
                style={{
                  borderRadius: p.radius === 'round' ? 999 : RADIUS_PX[p.radius],
                  ...(p.buttonStyle === 'solid'
                    ? { background: p.primaryColor, color: p.background }
                    : p.buttonStyle === 'outline'
                      ? { border: `1px solid ${p.primaryColor}`, color: p.foreground }
                      : { background: `${p.primaryColor}33`, color: p.foreground }),
                }}
              >
                Start
              </span>
            </span>
            <span className="flex items-center justify-between gap-1 px-0.5 pb-0.5">
              <span className="truncate text-xs font-medium">{p.label}</span>
              {selected ? (
                <i aria-hidden className="pi pi-check shrink-0 text-primary" style={{ fontSize: 10 }} />
              ) : null}
            </span>
          </button>
        );
      })}
      {!active ? (
        <p className="col-span-full text-[11px] text-muted-foreground">
          <i aria-hidden className="pi pi-pencil" style={{ fontSize: 10 }} /> {m.presetsCustom}
        </p>
      ) : null}
    </div>
  );
}
