import type { CSSProperties, ReactNode } from 'react';
import {
  accentVars,
  widgetStyleVars,
  brandingClassOf,
  clampAccent,
  onAccent,
  DEFAULT_ACCENT,
} from '@slate/shared';

/**
 * Wraps a public surface with the host's branding — the SAME engine output the
 * studio preview uses (preview == prod). Applies the accent (AA-clamped) as the
 * page's `--primary` and the widget vars (radii/spacing/font), AND emits
 * brandingClassOf() so the class-driven axes (cardStyle/slotLayout/dayGroup/
 * slotSelect/template) render via the .branded-surface CSS. All 9 axes reach the
 * DOM through this single wrapper.
 */
export function BrandedShell({
  brandColor,
  style,
  children,
}: {
  brandColor: string | null;
  style: Record<string, unknown> | null;
  children: ReactNode;
}) {
  const accent = clampAccent(brandColor ?? DEFAULT_ACCENT);
  const axes = (style ?? {}) as Record<string, string>;
  const vars = {
    ...accentVars(accent),
    ...widgetStyleVars({
      corners: axes.corners as never,
      density: axes.density as never,
      font: axes.font as never,
      buttons: axes.buttons as never,
    }),
    '--primary': accent,
    '--primary-foreground': onAccent(accent),
    '--ring': accent,
  } as CSSProperties;

  const cls = brandingClassOf({
    template: axes.template as never,
    cardStyle: axes.cardStyle as never,
    slotLayout: axes.slotLayout as never,
    dayGroup: axes.dayGroup as never,
    slotSelect: axes.slotSelect as never,
  });

  return (
    <div className={cls} style={vars}>
      {children}
    </div>
  );
}
