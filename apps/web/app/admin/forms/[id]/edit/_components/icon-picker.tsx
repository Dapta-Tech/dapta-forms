'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  isImageIcon,
  isSafeImageUrl,
  optionInitials,
  OPTION_ICON_GLYPH_MAX,
  type FormOptionLayout,
} from '@quill/engine';
import { cn } from '@/lib/cn';
import { TextField } from './fields';
import { EMOJI_GROUPS } from './emoji-catalog';
import type { EditorMessages } from './messages';

type Mode = 'emoji' | 'letters' | 'image';

/**
 * Picks an option's icon: an emoji from a small library, one or two letters
 * (HubSpot → "HS"), or an image URL.
 *
 * A raw text box could technically hold any of those, but nothing about it told
 * an author that an emoji or initials were even options — so the field only ever
 * got URLs. Each kind gets its own tab and its own input instead.
 *
 * `layout` gates the image tab: a logo in a list row renders as an illegible
 * sliver, so images are card-only in the editor as well as at render time
 * (`resolveOptionIcon`). Switching a question back to List therefore can't leave
 * an unreachable image behind — the tab is gone and the value falls back to
 * initials.
 */
export function IconPicker({
  value,
  onChange,
  label,
  layout,
  m,
}: {
  value: string | null | undefined;
  onChange: (icon: string | null) => void;
  /** The option's label — drives the initials preview. */
  label: string;
  layout: FormOptionLayout;
  m: EditorMessages['options'];
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const current = value?.trim() ?? '';
  const currentIsImage = isImageIcon(current);
  const imageAllowed = layout === 'cards';

  // Open on the tab that owns the CURRENT value: initials are ASCII letters,
  // anything else non-empty (an emoji) belongs to the emoji tab. Landing on
  // "Letters" while showing 😍 makes the picker look like it lost the value.
  const initialMode: Mode = currentIsImage
    ? 'image'
    : /^[A-Za-z]{1,2}$/.test(current)
      ? 'letters'
      : 'emoji';
  const [mode, setMode] = useState<Mode>(initialMode);

  // An image on a list question is unreachable: drop the tab and land on emoji.
  useEffect(() => {
    if (!imageAllowed && mode === 'image') setMode('emoji');
  }, [imageAllowed, mode]);

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

  const tabs = useMemo(() => {
    const all: { id: Mode; label: string }[] = [
      { id: 'emoji', label: m.iconTabEmoji },
      { id: 'letters', label: m.iconTabLetters },
    ];
    if (imageAllowed) all.push({ id: 'image', label: m.iconTabImage });
    return all;
  }, [imageAllowed, m]);

  const previewGlyph = current && !currentIsImage ? current : optionInitials(label);
  const showImagePreview = currentIsImage && imageAllowed && isSafeImageUrl(current);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={m.icon}
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 w-full items-center gap-2 rounded-md border border-input bg-background px-2 text-left text-sm transition-colors hover:border-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {/* The glyph keeps its muted disc (it needs a surface to sit on); a
            logo does not — same reasoning as the card icon. */}
        <span
          className={cn(
            'flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden text-sm leading-none',
            showImagePreview ? '' : 'rounded-md bg-muted',
          )}
        >
          {showImagePreview ? (
            <img src={current} alt="" className="max-h-full max-w-full object-contain" />
          ) : (
            previewGlyph
          )}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {current ? (currentIsImage ? current : current) : m.iconEmpty}
        </span>
        <i aria-hidden className="pi pi-chevron-down shrink-0 text-muted-foreground" style={{ fontSize: 10 }} />
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label={m.icon}
          className="absolute right-0 z-50 mt-1 w-[19rem] rounded-lg border border-border bg-popover p-2 shadow-lg"
        >
          <div className="mb-2 flex items-center gap-0.5 rounded-md border border-border bg-card p-0.5">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setMode(t.id)}
                aria-pressed={mode === t.id}
                className={cn(
                  'flex-1 whitespace-nowrap rounded-sm px-2 py-1 text-xs font-medium transition-colors',
                  mode === t.id
                    ? 'bg-muted text-foreground shadow-[inset_0_0_0_1px_var(--primary-edge)]'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {t.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
              className="shrink-0 rounded-sm px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-destructive"
            >
              {m.iconClear}
            </button>
          </div>

          {mode === 'emoji' ? (
            <div className="max-h-56 overflow-y-auto pr-1">
              {EMOJI_GROUPS.map((g) => (
                <div key={g.key} className="mb-2 last:mb-0">
                  <p className="mb-1 px-0.5 text-2xs font-semibold uppercase tracking-wide text-faint">
                    {m.emojiGroups[g.key]}
                  </p>
                  <div className="grid grid-cols-8 gap-0.5">
                    {g.emojis.map((e) => (
                      <button
                        key={e}
                        type="button"
                        aria-label={e}
                        aria-pressed={current === e}
                        onClick={() => {
                          onChange(e);
                          setOpen(false);
                        }}
                        className={cn(
                          'flex h-8 items-center justify-center rounded-sm text-lg leading-none transition-colors hover:bg-muted',
                          // The accent rim, not `ring-ring`: this is a selected
                          // state, not a focused one, and on LIGHT the two tokens
                          // are the same declaration — so the selected emoji and
                          // the focused one were the same colour while arrowing
                          // through, separated only by the global outline's 2px
                          // offset. An INSET shadow also stops the mark being
                          // clipped: this grid scrolls inside `overflow-y-auto`
                          // with no left padding, so an outset ring on the first
                          // column was cut off at the container's edge.
                          current === e && 'bg-muted shadow-[inset_0_0_0_1px_var(--primary-edge)]',
                        )}
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {mode === 'letters' ? (
            <div className="flex flex-col gap-1.5 p-1">
              <TextField
                autoFocus
                aria-label={m.iconTabLetters}
                data-testid="icon-picker-letters"
                maxLength={OPTION_ICON_GLYPH_MAX}
                placeholder={optionInitials(label) || 'HS'}
                value={currentIsImage ? '' : current}
                onChange={(e) => onChange(e.target.value.toUpperCase() || null)}
              />
              <p className="text-xs leading-relaxed text-muted-foreground">{m.iconLettersHint}</p>
            </div>
          ) : null}

          {mode === 'image' && imageAllowed ? (
            <div className="flex flex-col gap-1.5 p-1">
              <TextField
                autoFocus
                aria-label={m.iconTabImage}
                data-testid="icon-picker-url"
                placeholder="https://…"
                value={currentIsImage ? current : ''}
                onChange={(e) => onChange(e.target.value || null)}
              />
              {current && currentIsImage && !isSafeImageUrl(current) ? (
                <p className="text-xs text-destructive" role="alert">
                  {m.iconUrlInvalid}
                </p>
              ) : (
                <p className="text-xs leading-relaxed text-muted-foreground">{m.iconImageHint}</p>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
