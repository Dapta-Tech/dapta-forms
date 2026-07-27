'use client';

import { useState } from 'react';
import type { FormConfig, FormCover, FormOption, FormStep } from '@quill/engine';
import {
  resolveQuestion,
  sliderBounds,
  clampSliderValue,
  showBanner,
  resolveOptionLayout,
  resolveOptionIcon,
} from '@quill/engine';
import { clampAccent, onAccent, DEFAULT_ACCENT } from '@quill/shared';
import type { EditorMessages } from './messages';

/**
 * A faithful, read-only preview of the cover or a single step, styled with the
 * form's branding accent so the editor reflects the public surface. Interactive
 * within the preview (you can tap options / drag the slider) but never submits.
 */
export function LivePreview({
  config,
  selected,
  m,
}: {
  config: FormConfig;
  selected: number | 'cover';
  m: EditorMessages['preview'];
}) {
  const accent = clampAccent(config.branding?.primaryColor || DEFAULT_ACCENT);
  const accentText = onAccent(accent);
  const step: FormStep | undefined = typeof selected === 'number' ? config.steps[selected] : undefined;

  return (
    <div className="rounded-lg border border-border bg-background p-4">
      {selected === 'cover' ? (
        <CoverPreview config={config} accent={accent} accentText={accentText} m={m} />
      ) : step ? (
        <StepPreview step={step} cover={config.cover} accent={accent} accentText={accentText} m={m} index={selected} total={config.steps.length} />
      ) : (
        <p className="py-8 text-center text-sm text-muted-foreground">{m.empty}</p>
      )}
    </div>
  );
}

function CoverPreview({
  config,
  accent,
  accentText,
  m,
}: {
  config: FormConfig;
  accent: string;
  accentText: string;
  m: EditorMessages['preview'];
}) {
  const cover = config.cover ?? {};
  return (
    <div className="flex flex-col items-center gap-3 rounded-md border border-border bg-card p-6 text-center">
      {cover.bannerText ? (
        <div
          className="mb-1 w-full rounded-md px-3 py-1.5 text-xs font-medium"
          style={{ background: accent, color: accentText }}
        >
          {cover.bannerText}
        </div>
      ) : null}
      {cover.eyebrow ? (
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {cover.eyebrow}
        </span>
      ) : null}
      <h1 className="text-2xl font-semibold tracking-tight">{cover.headline || m.coverTitle}</h1>
      {cover.subheadline ? <p className="text-sm text-muted-foreground">{cover.subheadline}</p> : null}
      <button
        type="button"
        className="mt-1 rounded-md px-5 py-2.5 text-sm font-semibold transition-transform active:scale-[0.98]"
        style={{ background: accent, color: accentText }}
      >
        {cover.ctaText || 'Start'}
      </button>
      {cover.trustBadge ? <p className="text-xs text-muted-foreground">{cover.trustBadge}</p> : null}
    </div>
  );
}

/** The card layout's option icon — a circle for a glyph, a box for an image. */
function PreviewOptionIcon({ option }: { option: FormOption }) {
  const icon = resolveOptionIcon(option, 'cards');
  if (icon.kind === 'image') {
    // No plate: a logo brings its own shape, and a grey box behind it reads as
    // a chip rather than the card's icon.
    return (
      <span className="flex h-8 w-full max-w-[64px] items-center justify-center overflow-hidden">
        <img src={icon.src} alt="" className="max-h-full max-w-full object-contain" />
      </span>
    );
  }
  return (
    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-base leading-none">
      {icon.text}
    </span>
  );
}

function StepPreview({
  step,
  cover,
  accent,
  accentText,
  index,
  total,
  m,
}: {
  step: FormStep;
  cover?: FormCover | null;
  accent: string;
  accentText: string;
  index: number;
  total: number;
  m: EditorMessages['preview'];
}) {
  const [value, setValue] = useState<string | number>('');
  const question = resolveQuestion(step, {}) || step.key;
  // Only when the banner is scoped to the whole form — this is what makes the
  // cover/form scope toggle visible without leaving the editor.
  const banner = showBanner(cover, false) ? cover?.bannerText : null;
  const cards = step.type === 'multiple_choice' && resolveOptionLayout(step) === 'cards';

  return (
    <div className="flex flex-col gap-4 rounded-md border border-border bg-card p-6">
      {banner ? (
        <div
          className="-mt-1 w-full rounded-md px-3 py-1.5 text-center text-xs font-medium"
          style={{ background: accent, color: accentText }}
        >
          {banner}
        </div>
      ) : null}
      <div className="flex items-center gap-1.5" aria-hidden>
        {Array.from({ length: Math.max(total, 1) }).map((_, i) => (
          <span
            key={i}
            className="h-1.5 flex-1 rounded-full"
            style={{ background: i <= index ? accent : 'var(--muted)' }}
          />
        ))}
      </div>

      <p className="text-[11px] font-medium text-muted-foreground">
        {m.step} {index + 1} {m.of} {total}
      </p>

      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">
          {question}
          {step.required && step.type !== 'message' ? (
            <span aria-hidden style={{ color: accent }} className="ml-0.5">
              *
            </span>
          ) : null}
        </h2>
        {step.helper ? <p className="text-sm text-muted-foreground">{step.helper}</p> : null}
      </div>

      {step.type === 'message' ? null : step.type === 'dropdown' || step.type === 'multiple_choice' ? (
        // Mirror the public renderer's two layouts, so picking Cards in the
        // settings panel is visible without opening the form.
        <div
          className={
            cards ? 'grid grid-cols-3 gap-2' : 'flex flex-col gap-2'
          }
        >
          {(step.options ?? []).map((o) => {
            const on = value === o.value;
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => setValue(o.value)}
                className={
                  cards
                    ? 'flex flex-col items-center gap-2 rounded-md border px-2 py-3 text-center text-xs transition-colors'
                    : 'rounded-md border px-4 py-3 text-left text-sm transition-colors'
                }
                style={
                  on
                    ? { borderColor: accent, background: 'color-mix(in srgb, ' + accent + ' 15%, transparent)' }
                    : { borderColor: 'var(--border)' }
                }
              >
                {cards ? <PreviewOptionIcon option={o} /> : null}
                {o.label}
              </button>
            );
          })}
        </div>
      ) : step.type === 'slider' ? (
        (() => {
          const { min, max } = sliderBounds(step);
          // Clamped so an out-of-bounds default matches what a respondent sees
          // (a range input pins to its bounds anyway — V5-A2).
          const current = clampSliderValue(step, Number(value || step.default || min || 0));
          return (
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={min}
                max={max}
                step={step.step ?? 1}
                value={current}
                onChange={(e) => setValue(Number(e.target.value))}
                className="flex-1 accent-[var(--primary)]"
                style={{ accentColor: accent }}
              />
              <span className="w-12 text-right font-mono text-sm">{current}</span>
            </div>
          );
        })()
      ) : step.type === 'textarea' ? (
        <textarea
          value={String(value)}
          onChange={(e) => setValue(e.target.value)}
          placeholder={step.placeholder ?? undefined}
          rows={3}
          className="rounded-md border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      ) : (
        <input
          type={step.type === 'email' ? 'email' : step.type === 'phone' ? 'tel' : 'text'}
          value={String(value)}
          onChange={(e) => setValue(e.target.value)}
          placeholder={step.placeholder ?? undefined}
          className="rounded-md border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      )}

      <div className="flex justify-end">
        <button
          type="button"
          className="rounded-md px-5 py-2.5 text-sm font-semibold transition-transform active:scale-[0.98]"
          style={{ background: accent, color: accentText }}
        >
          {step.buttonText || (index + 1 === total ? 'Submit' : 'Next')}
        </button>
      </div>
    </div>
  );
}
