'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';
import type { FormConfig, FormStep, FormOption } from '@quill/engine';
import { nameFields, sliderBounds, clampSliderValue } from '@quill/engine';
import { clampAccent, onAccent, DEFAULT_ACCENT } from '@quill/shared';
import { cn } from '@/lib/cn';
import { iconForStep, hasOptions } from './question-types';
import { maxStepPoints } from './scoring-util';
import type { BuilderMessages } from './builder-messages';
import { tb } from './builder-messages';
import { TokenTextarea, tokenOptionsBefore, allTokenKeys } from './token-textarea';

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
                  <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border text-[11px] font-semibold text-muted-foreground">
                    {String.fromCharCode(65 + i)}
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
          ) : (
            <div className="rounded-xl border border-border bg-background px-4 py-3 text-[15px] text-muted-foreground/60">
              {step.placeholder ||
                (step.type === 'email' ? 'you@company.com' : step.type === 'phone' ? '+1 555 000 0000' : '…')}
            </div>
          )}
        </div>

        {/* Respondent's Next button (label editable for message/content) */}
        {step.type !== 'dropdown' ? (
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
