'use client';

import { useEffect, useRef, useState } from 'react';
import { FORM_FONTS, FORM_SERIF_FONTS, type FormFont } from '@quill/engine';
import { formFontStack } from '@/lib/fonts';
import { cn } from '@/lib/cn';
import type { EditorMessages } from './messages';

/** Display names are proper nouns, so they are not localized. */
const FONT_LABELS: Record<FormFont, string> = {
  visby: 'Visby CF',
  poppins: 'Poppins',
  inter: 'Inter',
  'dm-sans': 'DM Sans',
  'space-grotesk': 'Space Grotesk',
  manrope: 'Manrope',
  'work-sans': 'Work Sans',
  fraunces: 'Fraunces',
  playfair: 'Playfair Display',
  custom: '—',
};

const CURATED = FORM_FONTS.filter((f) => f !== 'custom');

/**
 * The typeface picker. Every option is rendered IN the face it selects — a list
 * of font names set in one font tells an author nothing about what they are
 * choosing, and this is the one control where the preview belongs in the menu
 * rather than only on the canvas.
 *
 * The list is grouped sans / serif because that is the decision an author is
 * actually making first; `custom` is a third group rather than a checkbox
 * elsewhere, so "use my own font" is discoverable from the same place.
 */
export function FontPicker({
  value,
  onChange,
  disabled = false,
  m,
}: {
  value: FormFont;
  onChange: (font: FormFont) => void;
  /** Read-only mode: the trigger renders but never opens the listbox. */
  disabled?: boolean;
  m: EditorMessages['design'];
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const groups: { label: string; fonts: FormFont[] }[] = [
    { label: m.fontSans, fonts: CURATED.filter((f) => !FORM_SERIF_FONTS.includes(f)) },
    { label: m.fontSerif, fonts: CURATED.filter((f) => FORM_SERIF_FONTS.includes(f)) },
    { label: m.fontCustomGroup, fonts: ['custom'] },
  ];

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={m.font}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 w-full items-center gap-2 rounded-md border border-input bg-background px-2.5 text-left transition-colors hover:border-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="min-w-0 flex-1 truncate text-sm" style={{ fontFamily: formFontStack(value) }}>
          {value === 'custom' ? m.fontCustomGroup : FONT_LABELS[value]}
        </span>
        <i aria-hidden className="pi pi-chevron-down shrink-0 text-muted-foreground" style={{ fontSize: 10 }} />
      </button>

      {open ? (
        <div
          role="listbox"
          aria-label={m.font}
          className="absolute left-0 top-10 z-50 max-h-72 w-full min-w-[14rem] overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg"
        >
          {groups.map((g) => (
            <div key={g.label} className="mb-1 last:mb-0">
              <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {g.label}
              </p>
              {g.fonts.map((f) => (
                <button
                  key={f}
                  type="button"
                  role="option"
                  aria-selected={value === f}
                  onClick={() => {
                    onChange(f);
                    setOpen(false);
                  }}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-muted',
                    value === f && 'bg-muted',
                  )}
                >
                  <span
                    className="min-w-0 truncate text-sm"
                    style={f === 'custom' ? undefined : { fontFamily: formFontStack(f) }}
                  >
                    {f === 'custom' ? m.fontCustomGroup : FONT_LABELS[f]}
                  </span>
                  {value === f ? (
                    <i aria-hidden className="pi pi-check shrink-0 text-muted-foreground" style={{ fontSize: 11 }} />
                  ) : null}
                </button>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
