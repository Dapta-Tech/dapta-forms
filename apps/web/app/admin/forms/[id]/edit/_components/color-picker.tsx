'use client';

import { useEffect, useRef, useState } from 'react';
import { contrastGrade, contrastRatio } from '@quill/shared';
import { cn } from '@/lib/cn';
import { TextField } from './fields';
import type { EditorMessages } from './messages';

const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * Curated swatches, arranged as a hue ramp so the grid reads as a spectrum
 * rather than a bag of colors. Two neutral rows bracket it because a form
 * background is far more often near-black or near-white than it is teal.
 */
const SWATCH_ROWS: readonly (readonly string[])[] = [
  ['#ffffff', '#faf9f6', '#f4f4f5', '#e4e4e7', '#a1a1aa', '#52525b', '#27272a', '#0d0d0f'],
  ['#fee2e2', '#fecaca', '#f87171', '#ef4444', '#dc2626', '#b91c1c', '#7f1d1d', '#b5533a'],
  ['#ffedd5', '#fed7aa', '#fb923c', '#f97316', '#ea580c', '#f2704a', '#e0b64f', '#f2c94c'],
  ['#ecfccb', '#d9f99d', '#cbe84f', '#a3e635', '#65a30d', '#4d7c0f', '#2b6e4f', '#6dd39a'],
  ['#dbeafe', '#bfdbfe', '#60a5fa', '#3b82f6', '#1f6feb', '#1d4ed8', '#12212e', '#0c4a6e'],
  ['#ede9fe', '#ddd6fe', '#a78bfa', '#8b5cf6', '#7c3aed', '#9059fc', '#16121f', '#4c1d95'],
];

/**
 * A per-form color control: swatches, a hex field, and — when the color sits on
 * a known ground — a live contrast readout.
 *
 * It replaces the native `<input type="color">`, which opened the operating
 * system's picker: a dialog the product has no control over, that looks
 * different on every machine, and that offers no idea whether the chosen color
 * is actually legible on this form. A native input is still rendered inside the
 * popover as the "custom" path, so the full gamut stays reachable and the
 * control remains operable for anyone who relies on the platform picker.
 */
export function ColorPicker({
  value,
  onChange,
  label,
  /** The color this one will be read against, for the contrast badge. */
  against,
  /** How the contrast pair is described, e.g. "Text on background". */
  againstLabel,
  allowEmpty = false,
  disabled = false,
  variant = 'field',
  emptyLabel,
  m,
}: {
  value: string | null | undefined;
  onChange: (color: string | null) => void;
  label: string;
  against?: string | null;
  againstLabel?: string;
  /** When true, clearing the field is allowed and means "inherit". */
  allowEmpty?: boolean;
  /** Read-only mode: the trigger renders but never opens the popover. */
  disabled?: boolean;
  /**
   * `field`: a one-line control (swatch, hex, chevron) for a dense panel.
   * `card`: the colour as a block with its name and hex under it, for a screen
   * where the three colours ARE the setting (the brand kit).
   */
  variant?: 'field' | 'card';
  /** What an unset colour reads as. Defaults to "Custom". */
  emptyLabel?: string;
  m: EditorMessages['design'];
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const current = value?.trim() ?? '';
  const valid = HEX.test(current);
  // While the hex field is mid-edit the draft wins, so typing "#1f6" doesn't
  // fight the committed value on every keystroke.
  const shown = draft ?? current;

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

  const card = variant === 'card';
  const ratio = against && valid ? contrastRatio(current, against) : null;
  const grade = ratio === null ? null : contrastGrade(ratio);

  function commit(next: string) {
    setDraft(next);
    if (HEX.test(next)) onChange(next.toLowerCase());
    else if (allowEmpty && next.trim() === '') onChange(null);
  }

  return (
    <div ref={rootRef} className="relative flex flex-col gap-1.5">
      <div className={card ? 'flex flex-col gap-2' : 'flex items-center gap-2'}>
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={label}
          disabled={disabled}
          onClick={() => setOpen((v) => !v)}
          className={
            card
              ? 'flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-card p-2 text-left transition-colors hover:border-input focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
              : 'flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border border-input bg-background px-2 text-left transition-colors hover:border-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
          }
        >
          <span
            aria-hidden
            className={cn('shrink-0 border border-border', card ? 'h-11 w-full rounded-lg' : 'h-5 w-5 rounded-sm')}
            style={{
              background: valid ? current : 'transparent',
              // An unset color reads as a checker-ish neutral rather than as
              // black, which would look like a deliberate choice.
              backgroundImage: valid
                ? undefined
                : 'linear-gradient(135deg, var(--muted) 45%, var(--border) 45%, var(--border) 55%, var(--muted) 55%)',
            }}
          />
          {card ? (
            <span className="flex min-w-0 flex-col px-0.5 pb-0.5">
              <span className="truncate text-xs font-medium text-foreground" title={label}>{label}</span>
              <span className="truncate text-xs uppercase text-muted-foreground" title={valid ? current : (emptyLabel ?? m.colorCustom)}>
                {valid ? current : (emptyLabel ?? m.colorCustom)}
              </span>
            </span>
          ) : (
            <>
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                {valid ? current : (emptyLabel ?? m.colorCustom)}
              </span>
              <i aria-hidden className="pi pi-chevron-down shrink-0 text-muted-foreground" style={{ fontSize: 10 }} />
            </>
          )}
        </button>

        {grade ? (
          <span
            data-testid="contrast-badge"
            title={`${againstLabel ?? ''} ${ratio}:1`}
            className={cn(
              'rounded-sm px-1.5 py-0.5 text-2xs font-semibold tabular-nums',
              card ? 'self-start' : 'shrink-0',
              grade === 'fail'
                ? 'bg-destructive/15 text-destructive'
                : 'bg-muted text-muted-foreground',
            )}
          >
            {grade === 'fail' ? `${ratio}:1` : `${grade} ${ratio}:1`}
          </span>
        ) : null}
      </div>

      {grade === 'fail' ? (
        <p className="text-xs text-destructive" role="alert">
          {m.contrastFail}
        </p>
      ) : null}

      {open ? (
        <div
          role="dialog"
          aria-label={label}
          className="absolute left-0 top-11 z-50 w-[17rem] rounded-lg border border-border bg-popover p-2.5 shadow-lg"
        >
          <p className="mb-1.5 text-2xs font-semibold uppercase tracking-wide text-faint">
            {m.colorSwatches}
          </p>
          <div className="flex flex-col gap-1">
            {SWATCH_ROWS.map((row, ri) => (
              <div key={ri} className="grid grid-cols-8 gap-1">
                {row.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={c}
                    aria-pressed={current.toLowerCase() === c}
                    onClick={() => {
                      setDraft(null);
                      onChange(c);
                      setOpen(false);
                    }}
                    style={{ background: c }}
                    className={cn(
                      'h-6 w-full rounded-sm border border-border/60 transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      current.toLowerCase() === c && 'ring-2 ring-ring',
                    )}
                  />
                ))}
              </div>
            ))}
          </div>

          <div className="mt-2.5 flex items-center gap-2 border-t border-border pt-2.5">
            <input
              type="color"
              aria-label={m.colorCustom}
              value={valid ? current : '#888888'}
              onChange={(e) => {
                setDraft(null);
                onChange(e.target.value);
              }}
              className="h-8 w-9 shrink-0 cursor-pointer rounded-sm border border-input bg-background p-0.5"
            />
            <TextField
              aria-label={m.colorHex}
              value={shown}
              placeholder="#1f6feb"
              spellCheck={false}
              onChange={(e) => commit(e.target.value)}
              onBlur={() => setDraft(null)}
              className="h-8 py-1 text-xs"
            />
            {allowEmpty ? (
              <button
                type="button"
                onClick={() => {
                  setDraft(null);
                  onChange(null);
                  setOpen(false);
                }}
                className="shrink-0 rounded-sm px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-destructive"
              >
                {m.reset}
              </button>
            ) : null}
          </div>
          {shown && !HEX.test(shown) ? (
            <p className="mt-1.5 text-xs text-destructive" role="alert">
              {m.colorInvalid}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
