'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';
import type { FormConfig, FormStep, FormOption } from '@quill/engine';
import {
  nameFields,
  sliderBounds,
  clampSliderValue,
  resolveOptionLayout,
  isImageIcon,
  isSafeImageUrl,
} from '@quill/engine';
import { clampAccent, onAccent, DEFAULT_ACCENT } from '@quill/shared';
import { cn } from '@/lib/cn';
import { iconForStep, hasOptions } from './question-types';
import { maxStepPoints } from './scoring-util';
import type { BuilderMessages } from './builder-messages';
import { tb } from './builder-messages';
import { TokenTextarea, tokenOptionsBefore, allTokenKeys } from './token-textarea';
import { SchedulerEmbedPreview } from './scheduler-embed-preview';

/** The reveal's play time when the card configures none (mirrors the renderer). */
const DEFAULT_REVEAL_MS = 2200;

/** A textarea that grows to fit its content (used for inline title/description). */
function AutoTextarea({
  value,
  onChange,
  placeholder,
  className,
  ariaLabel,
  autoFocus,
  rows = 1,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  className?: string;
  ariaLabel: string;
  autoFocus?: boolean;
  rows?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  useEffect(() => {
    if (autoFocus && ref.current) {
      const el = ref.current;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, [autoFocus]);
  return (
    <textarea
      ref={ref}
      rows={rows}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={ariaLabel}
      className={cn(
        'w-full resize-none overflow-hidden bg-transparent outline-none placeholder:text-muted-foreground/50',
        className,
      )}
    />
  );
}

/**
 * The WYSIWYG canvas — the selected question rendered exactly as a respondent
 * sees it, but editable in place: the title and description are inline textareas
 * (dashed focus underline), choices are the real selectable rows with an inline
 * point chip and letter badge, and "+ Add option" is the last row. Styled with
 * the form's branding accent so the editor reflects the public surface.
 */
export function CanvasQuestion({
  config,
  step,
  index,
  total,
  device,
  onUpdate,
  m,
}: {
  config: FormConfig;
  step: FormStep;
  index: number;
  total: number;
  device: 'desktop' | 'mobile';
  onUpdate: (patch: Partial<FormStep>) => void;
  m: BuilderMessages;
}) {
  const accent = clampAccent(config.branding?.primaryColor || DEFAULT_ACCENT);
  const accentText = onAccent(accent);
  const progress = total > 0 ? Math.round(((index + 1) / total) * 100) : 0;
  const showsPoints =
    (config.scoring?.enabled ?? false) !== false && step.flowGroup !== 'lead_capture' && maxStepPoints(step) >= 0;
  const cardLayout = step.type === 'multiple_choice' && resolveOptionLayout(step) === 'cards';

  function updateOption(i: number, patch: Partial<FormOption>) {
    onUpdate({ options: (step.options ?? []).map((o, oi) => (oi === i ? { ...o, ...patch } : o)) });
  }
  function addOption() {
    const n = (step.options ?? []).length + 1;
    onUpdate({ options: [...(step.options ?? []), { label: `Option ${n}`, value: `option_${n}`, points: 0 }] });
  }
  function removeOption(i: number) {
    onUpdate({ options: (step.options ?? []).filter((_, oi) => oi !== i) });
  }

  const isLast = index + 1 >= total;

  // A reveal is not a question — it asks nothing, has no title, no description
  // and no Next button, and the respondent sees a spinner over the configured
  // copy. Rendering it through the question chrome below produced a card with a
  // "…" short-answer box and a Next button that never exist at runtime, so it
  // gets its own WYSIWYG card.
  if (step.type === 'reveal') {
    return (
      <RevealCanvas
        step={step}
        accent={accent}
        device={device}
        onUpdate={onUpdate}
        m={m}
      />
    );
  }

  return (
    <div className="flex justify-center">
      <div
        className={cn(
          'w-full rounded-2xl border border-border bg-card p-6 shadow-xl sm:p-8',
          device === 'mobile' ? 'max-w-[380px]' : 'max-w-[640px]',
        )}
      >
        {/* Respondent progress bar */}
        <div className="mb-6 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full transition-all" style={{ width: `${progress}%`, background: accent }} />
        </div>

        {/* Eyebrow */}
        <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <i aria-hidden className={`pi ${iconForStep(step)}`} style={{ fontSize: 12 }} />
          {tb(m.canvas.questionN, { n: index + 1 })}
        </p>

        {/* Inline editable title — with the @ recall-information picker. The
            engine interpolates `[key]` tokens in BOTH `question` and the
            description/`helper` from EARLIER answers (resolveStepDisplay), so
            both fields get the picker. */}
        <TokenTextarea
          value={step.question ?? ''}
          onChange={(v) => onUpdate({ question: v })}
          placeholder={m.canvas.titlePlaceholder}
          ariaLabel={m.canvas.titlePlaceholder}
          autoGrow
          tokens={tokenOptionsBefore(config.steps, index)}
          allKeys={allTokenKeys(config.steps)}
          m={m.tokens}
          hint={m.tokens.hint}
          testId="canvas-title-input"
          className="canvas-title text-2xl font-semibold tracking-tight text-foreground sm:text-[28px]"
        />

        {/* Inline editable description — same @ picker as the title (tokens =
            fields captured before this step). No hint here so the single
            discoverability chip stays under the title. */}
        <div className="mt-1.5">
          <TokenTextarea
            value={step.helper ?? ''}
            onChange={(v) => onUpdate({ helper: v || null })}
            placeholder={m.canvas.descriptionPlaceholder}
            ariaLabel={m.canvas.descriptionPlaceholder}
            autoGrow
            tokens={tokenOptionsBefore(config.steps, index)}
            allKeys={allTokenKeys(config.steps)}
            m={m.tokens}
            testId="canvas-description-input"
            className="text-[15px] leading-relaxed text-muted-foreground"
          />
        </div>

        {/* Body: the real rendered input */}
        <div className="mt-6">
          {hasOptions(step.type) ? (
            <div className="flex flex-col gap-2.5">
              {(step.options ?? []).map((opt, i) => (
                <div
                  key={i}
                  className="group flex items-center gap-3 rounded-xl border border-border bg-background px-4 py-3.5 transition-colors focus-within:border-primary/60 hover:border-muted-foreground/60"
                >
                  {/* The canvas stays a vertical list even for the card layout —
                      it is an inline EDITOR, not a preview. Swapping the A/B/C
                      badge for the option's own icon is enough to see what each
                      card will carry; Preview shows the real grid. */}
                  <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border text-[11px] font-semibold text-muted-foreground">
                    {cardLayout && opt.icon ? (
                      isImageIcon(opt.icon) && isSafeImageUrl(opt.icon) ? (
                        <img src={opt.icon} alt="" className="max-h-full max-w-full object-contain" />
                      ) : (
                        <span className="text-[13px] leading-none">{opt.icon}</span>
                      )
                    ) : (
                      String.fromCharCode(65 + i)
                    )}
                  </span>
                  <input
                    value={opt.label}
                    onChange={(e) => updateOption(i, { label: e.target.value })}
                    placeholder={`${m.canvas.optionPlaceholder} ${i + 1}`}
                    aria-label={`${m.canvas.optionPlaceholder} ${i + 1}`}
                    className="min-w-0 flex-1 bg-transparent text-[15px] font-medium text-foreground outline-none placeholder:text-muted-foreground/50"
                  />
                  {showsPoints ? (
                    <span className="shrink-0 rounded-full bg-primary/15 px-2.5 py-1 text-xs font-semibold text-primary">
                      {tb(m.canvas.pts, { n: opt.points ?? 0 })}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    aria-label={m.settings.delete}
                    onClick={() => removeOption(i)}
                    className="shrink-0 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground hover:!text-destructive focus-visible:!text-muted-foreground focus-visible:outline-none"
                  >
                    <i aria-hidden className="pi pi-times" style={{ fontSize: 12 }} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={addOption}
                className="flex items-center gap-3 rounded-xl border border-dashed border-border px-4 py-3.5 text-left text-[15px] text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-dashed border-border">
                  <i aria-hidden className="pi pi-plus" style={{ fontSize: 11 }} />
                </span>
                {m.canvas.addOption}
              </button>
            </div>
          ) : step.type === 'slider' ? (
            <SliderPreview step={step} accent={accent} />
          ) : step.type === 'message' ? (
            <AutoTextarea
              value={step.helper ?? ''}
              onChange={(v) => onUpdate({ helper: v || null })}
              placeholder={m.canvas.messagePlaceholder}
              ariaLabel={m.canvas.messagePlaceholder}
              rows={2}
              className="text-[15px] leading-relaxed text-foreground"
            />
          ) : step.type === 'textarea' ? (
            <div className="rounded-xl border border-border bg-background px-4 py-3 text-[15px] text-muted-foreground/60">
              {step.placeholder || m.canvas.messagePlaceholder}
            </div>
          ) : step.type === 'name' ? (
            <NamePreview step={step} m={m} />
          ) : step.type === 'scheduler' ? (
            <SchedulerEmbedPreview step={step} m={m} />
          ) : (
            <div className="rounded-xl border border-border bg-background px-4 py-3 text-[15px] text-muted-foreground/60">
              {step.placeholder ||
                (step.type === 'email' ? 'you@company.com' : step.type === 'phone' ? '+1 555 000 0000' : '…')}
            </div>
          )}
        </div>

        {/* Respondent's Next button (label editable for message/content). A
            scheduler has none: booking IS the answer, so the public form
            advances itself — showing a Submit here promised a button that never
            renders. */}
        {step.type !== 'dropdown' && step.type !== 'scheduler' ? (
          <div className="mt-7">
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold"
              style={{ background: accent, color: accentText }}
            >
              {step.buttonText || (isLast ? m.canvas.submit : m.canvas.next)}
              <i aria-hidden className="pi pi-arrow-right" style={{ fontSize: 12 }} />
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The reveal card, rendered as the respondent will see it: the accent spinner,
 * the headline and subtitle, and the progress bar filling over the configured
 * duration — looping, so the author can feel how long `durationMs` actually is.
 *
 * The copy is edited IN PLACE (same inline-textarea idiom as a question title),
 * which is why this mirrors the public `.pf-reveal__*` markup by hand instead of
 * mounting `<RevealScreen>`: that component owns its own timer and renders the
 * copy as static text, so it could preview the screen or let you edit it, not
 * both. Duration and pre-warm stay in the settings panel.
 */
function RevealCanvas({
  step,
  accent,
  device,
  onUpdate,
  m,
}: {
  step: FormStep;
  accent: string;
  device: 'desktop' | 'mobile';
  onUpdate: (patch: Partial<FormStep>) => void;
  m: BuilderMessages;
}) {
  const durationMs = step.reveal?.durationMs ?? DEFAULT_REVEAL_MS;
  return (
    <div className="flex justify-center">
      <div
        data-testid="canvas-reveal-preview"
        className={cn(
          'flex w-full flex-col items-center rounded-2xl border border-border bg-card px-6 py-14 shadow-xl sm:px-8',
          device === 'mobile' ? 'max-w-[380px]' : 'max-w-[640px]',
        )}
      >
        <div
          aria-hidden
          data-testid="canvas-reveal-spinner"
          className="qb-reveal__spinner mb-7 h-[52px] w-[52px] rounded-full border-4 border-muted"
          style={{ borderTopColor: accent }}
        />
        <AutoTextarea
          value={step.reveal?.headline ?? ''}
          onChange={(v) => onUpdate({ reveal: { ...step.reveal, headline: v || null } })}
          placeholder={m.canvas.revealHeadlinePlaceholder}
          ariaLabel={m.canvas.revealHeadlinePlaceholder}
          className="canvas-title max-w-[420px] text-center text-[26px] font-extrabold leading-tight tracking-tight text-foreground"
        />
        <div className="mt-2 w-full max-w-[420px]">
          <AutoTextarea
            value={step.reveal?.subtitle ?? ''}
            onChange={(v) => onUpdate({ reveal: { ...step.reveal, subtitle: v || null } })}
            placeholder={m.canvas.revealSubtitlePlaceholder}
            ariaLabel={m.canvas.revealSubtitlePlaceholder}
            rows={2}
            className="text-center text-[15px] leading-relaxed text-muted-foreground"
          />
        </div>
        <div className="mt-6 h-2 w-[260px] max-w-full overflow-hidden rounded-full bg-muted">
          <div
            className="qb-reveal__fill h-full rounded-full"
            style={{ background: accent, animationDuration: `${durationMs}ms` }}
          />
        </div>
        <p className="mt-5 text-xs text-muted-foreground">
          {tb(m.canvas.revealPlays, { ms: durationMs })}
        </p>
      </div>
    </div>
  );
}

/**
 * Live name-step preview: the same `nameFields(step)` order and
 * `step.placeholders` fallbacks as the public renderer (configured placeholder,
 * else the localized default) — so typing a placeholder in the settings panel
 * updates the canvas immediately, exactly as it will publish.
 */
function NamePreview({ step, m }: { step: FormStep; m: BuilderMessages }) {
  const [firstField, secondField] = nameFields(step);
  const firstLabel = (firstField && step.placeholders?.[firstField]) || m.canvas.nameFirstPlaceholder;
  const secondLabel = (secondField && step.placeholders?.[secondField]) || m.canvas.nameLastPlaceholder;
  const boxClass =
    'w-full rounded-xl border border-border bg-background px-4 py-3 text-[15px] text-foreground outline-none placeholder:text-muted-foreground/60';
  return (
    <div className="grid grid-cols-2 gap-3">
      {firstField ? (
        <input
          disabled
          placeholder={firstLabel}
          aria-label={firstLabel}
          data-testid="canvas-name-first"
          className={boxClass}
        />
      ) : null}
      {secondField ? (
        <input
          disabled
          placeholder={secondLabel}
          aria-label={secondLabel}
          data-testid="canvas-name-second"
          className={boxClass}
        />
      ) : null}
    </div>
  );
}

function SliderPreview({ step, accent }: { step: FormStep; accent: string }) {
  const { min, max } = sliderBounds(step);
  // Clamped: a stored default outside the bounds would otherwise drive `pct`
  // far past 100 and stretch the filled track clean out of the card (V5-A2).
  const value = clampSliderValue(step, step.default ?? min);
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <div className="flex flex-col gap-3 py-2">
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-semibold text-foreground">{value}</span>
        {step.sliderUnitLabel ? <span className="text-sm text-muted-foreground">{step.sliderUnitLabel}</span> : null}
      </div>
      <div className="relative h-2 w-full rounded-full bg-muted">
        <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${pct}%`, background: accent }} />
        <span
          className="absolute top-1/2 h-5 w-5 -translate-y-1/2 rounded-full border-2 border-card shadow"
          style={{ left: `calc(${pct}% - 10px)`, background: accent }}
        />
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}
