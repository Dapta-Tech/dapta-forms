'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';
import type { FormConfig, FormStep, FormOption } from '@quill/engine';
import {
  nameFields,
  sliderBounds,
  clampSliderValue,
  resolveOptionLayout,
  resolveOptionIcon,
  resolveDesign,
  resolveRevealPresentation,
} from '@quill/engine';
import { onAccent, DEFAULT_ACCENT, getMessages } from '@quill/shared';
import { clientLocale } from '@/lib/client-locale';
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
  style,
  ariaLabel,
  autoFocus,
  rows = 1,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  className?: string;
  /** Inline overrides for values the canvas computes — the reveal's type scale. */
  style?: React.CSSProperties;
  ariaLabel: string;
  autoFocus?: boolean;
  rows?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // Re-measure on the TYPE SCALE too, not just the text. The box is
  // `overflow-hidden`, so a font-size change with a stale height silently clips
  // the line — which is exactly what picking the reveal's "Large" text size did
  // to its headline.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value, style?.fontSize, style?.lineHeight]);
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
      style={style}
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
  // The author's exact color, matching the renderer and the live preview. This
  // used to call `clampAccent` with no ground, so it corrected against the dark
  // canvas — which meant the canvas, the preview and the published page could
  // each show a different accent. Nothing corrects a chosen color any more.
  const accent = config.branding?.primaryColor?.trim() || DEFAULT_ACCENT;
  const accentText = onAccent(accent);

  // The canvas honours the design axes that change SHAPE — corner radius,
  // measure, alignment, and how the primary action and progress are drawn — so
  // the builder never contradicts the form about its structure.
  //
  // It deliberately does NOT take the palette or the typeface. This is an
  // EDITING surface: the title and description are inline textareas, options are
  // dragged and renamed, and there are point chips and delete controls layered
  // on top. A brand background, a decorative image or a display serif make that
  // work harder to do, and the editing affordances need admin contrast rather
  // than the author's. The real appearance lives in the preview beside it and in
  // the Preview modal, both of which render the form exactly as published.
  const design = resolveDesign(config.branding);
  // Mirrors `public-form.css`'s `data-pf-radius` block EXACTLY — card is
  // `--pf-radius`, button is `--pf-radius-btn`. Written as arbitrary values on
  // purpose: the admin's `rounded-*` ladder is the CHROME's scale and retuning it
  // must not silently move what the canvas claims a published form looks like.
  // These drifted (card soft showed 20px against the renderer's 16, button soft
  // 16px against 8) — a preview that rounds differently than the page is the one
  // thing this component exists to prevent.
  //
  // The same holds for this file's `text-[Npx]` values, and for the same reason:
  // 15px body, 28px headline, 26px reveal title and the 23px emoji are the
  // RENDERER's sizes (grep `font-size` in `public-form.css` — 15px appears nine
  // times), not the admin's. A sweep that pulls them onto the chrome's pinned
  // ladder makes the canvas lie about the published page. They are deliberately
  // off-ladder; leave them there.
  const cardRadius =
    design.radius === 'sharp' ? 'rounded-[2px]' : design.radius === 'round' ? 'rounded-[24px]' : 'rounded-[16px]';
  const btnRadius =
    design.radius === 'sharp' ? 'rounded-[2px]' : design.radius === 'round' ? 'rounded-full' : 'rounded-[8px]';
  const canvasWidth =
    device === 'mobile' ? 'max-w-[380px]' : design.contentWidth === 'wide' ? 'max-w-[760px]' : 'max-w-[640px]';
  const centred = design.contentAlign === 'center';
  const btnStyle =
    design.buttonStyle === 'outline'
      ? { background: 'transparent', color: 'var(--foreground)', border: `1.5px solid ${accent}` }
      : design.buttonStyle === 'soft'
        ? {
            background: `color-mix(in srgb, ${accent} 18%, var(--card))`,
            color: 'var(--foreground)',
            border: `1px solid color-mix(in srgb, ${accent} 32%, transparent)`,
          }
        : { background: accent, color: accentText };
  const progress = total > 0 ? Math.round(((index + 1) / total) * 100) : 0;
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
      <div className={cn('w-full border border-border bg-card p-6 shadow-xl sm:p-8', cardRadius, canvasWidth)}>
        {/* Respondent progress — drawn the way the form draws it, so choosing
            dots or hiding it entirely is visible while building. */}
        {design.progressStyle === 'bar' ? (
          <div className="mb-6 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full transition-all" style={{ width: `${progress}%`, background: accent }} />
          </div>
        ) : design.progressStyle === 'dots' ? (
          <div className="mb-6 flex items-center justify-center gap-1.5">
            {Array.from({ length: Math.max(total, 1) }).map((_, i) => (
              <span
                key={i}
                className={cn('h-1.5 w-1.5 rounded-full transition-transform', i === index && 'scale-150')}
                style={{ background: i <= index ? accent : 'var(--muted)' }}
              />
            ))}
          </div>
        ) : design.progressStyle === 'steps' ? (
          <p className="mb-6 text-center text-[11px] font-semibold tabular-nums text-muted-foreground">
            {index + 1} / {total}
          </p>
        ) : null}

        <QuestionEditableBody
          config={config}
          step={step}
          index={index}
          accent={accent}
          onUpdate={onUpdate}
          m={m}
        />

        {/* Respondent's Next button (label editable for message/content). A
            scheduler has none: booking IS the answer, so the public form
            advances itself — showing a Submit here promised a button that never
            renders. */}
        {step.type !== 'dropdown' && step.type !== 'scheduler' ? (
          <div className={cn('mt-7', centred && !design.buttonFullWidth && 'text-center')}>
            <button
              type="button"
              className={cn(
                'items-center justify-center gap-2 px-6 py-3 text-sm font-semibold',
                btnRadius,
                design.buttonFullWidth ? 'flex w-full' : 'inline-flex',
              )}
              style={btnStyle}
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
 * The editable heart of a question — eyebrow, inline title/description with the
 * @ token picker, and the type-specific body (options, slider, name fields…).
 * Shared verbatim by the slides card (`CanvasQuestion`) and the one-page canvas
 * (`CanvasPage`), so the two layouts can never drift on how editing works.
 */
function QuestionEditableBody({
  config,
  step,
  index,
  accent,
  onUpdate,
  m,
}: {
  config: FormConfig;
  step: FormStep;
  index: number;
  accent: string;
  onUpdate: (patch: Partial<FormStep>) => void;
  m: BuilderMessages;
}) {
  const showsPoints =
    (config.scoring?.enabled ?? false) !== false && step.flowGroup !== 'lead_capture' && maxStepPoints(step) >= 0;
  const cardLayout = step.type === 'multiple_choice' && resolveOptionLayout(step) === 'cards';
  // Derived here rather than passed in, so the per-step card and the vertical
  // page canvas both pick up the shape axes from the one place that renders a
  // question. Colour and typeface are deliberately NOT taken — see CanvasQuestion.
  const design = resolveDesign(config.branding);
  // `.pf-choice-list` (the option row) reads `--pf-radius-sm`: 2 / 8 / 14px.
  const optionRadius =
    design.radius === 'sharp' ? 'rounded-[2px]' : design.radius === 'round' ? 'rounded-[14px]' : 'rounded-[8px]';
  const centred = design.contentAlign === 'center';

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

  return (
    <>
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
        className={cn(
          'canvas-title text-2xl font-semibold tracking-tight text-foreground sm:text-[28px]',
          centred && 'text-center',
        )}
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
          className={cn('text-[15px] leading-relaxed text-muted-foreground', centred && 'text-center')}
        />
      </div>

      {/* Body: the real rendered input */}
      <div className="mt-6">
        {hasOptions(step.type) ? (
          // The canvas mirrors the CHOSEN layout — picking Cards and still
          // seeing a radio list here is the builder contradicting the form.
          // Both branches keep the label editable inline; only the shell and
          // the icon treatment differ, exactly as the public renderer does.
          <div
            className={
              cardLayout
                ? 'flex flex-wrap justify-center gap-2.5'
                : 'flex flex-col gap-2.5'
            }
          >
            {(step.options ?? []).map((opt, i) => {
              const icon = resolveOptionIcon(opt, cardLayout ? 'cards' : 'list');
              return cardLayout ? (
                <div
                  key={i}
                  className={cn(
                    'group relative flex min-h-[104px] w-[calc((100%-1.25rem)/3)] min-w-[132px] max-w-[220px] flex-col items-center gap-2 border border-border bg-background px-2 py-4 transition-colors focus-within:border-primary-edge/60 hover:border-muted-foreground/60',
                    optionRadius,
                  )}
                >
                  {icon.kind === 'image' ? (
                    // No plate behind a logo — it carries its own shape. The
                    // band is only reserved so cards keep one baseline.
                    <span className="flex h-[46px] w-full max-w-[96px] items-center justify-center overflow-hidden">
                      <img src={icon.src} alt="" className="max-h-full max-w-full object-contain" />
                    </span>
                  ) : (
                    <span className="flex h-[46px] w-[46px] items-center justify-center rounded-full bg-muted text-[23px] leading-none">
                      {icon.text}
                    </span>
                  )}
                  <input
                    value={opt.label}
                    onChange={(e) => updateOption(i, { label: e.target.value })}
                    placeholder={`${m.canvas.optionPlaceholder} ${i + 1}`}
                    aria-label={`${m.canvas.optionPlaceholder} ${i + 1}`}
                    className="w-full min-w-0 bg-transparent text-center text-sm font-medium text-foreground outline-none placeholder:text-muted-foreground/50"
                  />
                  {showsPoints ? (
                    <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary">
                      {tb(m.canvas.pts, { n: opt.points ?? 0 })}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    aria-label={m.settings.delete}
                    onClick={() => removeOption(i)}
                    className="absolute right-1.5 top-1.5 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground hover:!text-destructive focus-visible:!text-muted-foreground focus-visible:outline-none"
                  >
                    <i aria-hidden className="pi pi-times" style={{ fontSize: 12 }} />
                  </button>
                </div>
              ) : (
                <div
                  key={i}
                  className={cn(
                    'group flex items-center gap-3 border border-border bg-background px-4 py-3.5 transition-colors focus-within:border-primary-edge/60 hover:border-muted-foreground/60',
                    optionRadius,
                  )}
                >
                  <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border text-[11px] font-semibold text-muted-foreground">
                    {opt.icon && icon.kind === 'glyph' ? (
                      <span className="text-[13px] leading-none">{icon.text}</span>
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
              );
            })}
            <button
              type="button"
              onClick={addOption}
              className={
                cardLayout
                  ? 'flex min-h-[104px] w-[calc((100%-1.25rem)/3)] min-w-[132px] max-w-[220px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border px-2 py-4 text-sm text-muted-foreground transition-colors hover:border-primary-edge/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                  : 'flex items-center gap-3 rounded-xl border border-dashed border-border px-4 py-3.5 text-left text-[15px] text-muted-foreground transition-colors hover:border-primary-edge/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
              }
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
    </>
  );
}

/**
 * The one-page WYSIWYG canvas (`layout = 'vertical'`): the WHOLE form as the
 * respondent sees it — every question stacked on one page, each editable in
 * place, one Submit at the end. No per-question card, progress bar or Next
 * button, because the published page has none. Selecting a question (spine,
 * mobile strip, or clicking a block) highlights it and scrolls it into view,
 * so switching questions FEELS like moving down one page — which is exactly
 * what it is.
 */
export function CanvasPage({
  config,
  selected,
  device,
  focusSignal = 0,
  onSelect,
  onUpdateStep,
  m,
}: {
  config: FormConfig;
  selected: number;
  device: 'desktop' | 'mobile';
  /** Increments when a question was just added — focus its title. */
  focusSignal?: number;
  onSelect: (index: number) => void;
  onUpdateStep: (index: number, patch: Partial<FormStep>) => void;
  m: BuilderMessages;
}) {
  // The author's exact color, like every other surface — nothing corrects a
  // chosen color any more.
  const accent = config.branding?.primaryColor?.trim() || DEFAULT_ACCENT;
  const accentText = onAccent(accent);
  const blockRefs = useRef<Map<string, HTMLElement>>(new Map());

  // Selection navigates the page: scroll the picked block into view. Skipped
  // for plain in-page clicks (the block is already on screen — jumping would
  // yank the page under the author's cursor); a click's own scroll is a no-op
  // because the browser only scrolls to something out of view.
  const selectedKey = config.steps[selected]?.key;
  useEffect(() => {
    if (!selectedKey) return;
    blockRefs.current.get(selectedKey)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [selectedKey]);

  // A just-added question lands selected at the end — put the caret in its title.
  useEffect(() => {
    if (!focusSignal || !selectedKey) return;
    const el = blockRefs.current.get(selectedKey)?.querySelector('textarea');
    (el as HTMLTextAreaElement | null)?.focus();
  }, [focusSignal]);

  return (
    <div className="flex justify-center">
      <div
        data-testid="canvas-page"
        className={cn(
          'w-full overflow-hidden rounded-2xl border border-border bg-card shadow-xl',
          device === 'mobile' ? 'max-w-[400px]' : 'max-w-[720px]',
        )}
      >
        <div className="flex flex-col divide-y divide-border">
          {config.steps.map((step, i) => (
            <section
              key={step.key}
              ref={(el) => {
                if (el) blockRefs.current.set(step.key, el);
                else blockRefs.current.delete(step.key);
              }}
              data-testid={`page-block-${i}`}
              aria-current={i === selected || undefined}
              // Focus/click anywhere in a block selects it, so the settings
              // panel always describes the question under the caret.
              onMouseDownCapture={() => onSelect(i)}
              onFocusCapture={() => onSelect(i)}
              className={cn(
                'scroll-my-16 px-6 py-6 transition-colors sm:px-8',
                // The accent EDGE at full alpha, not `ring-primary/40`: this is the
                // canvas's ONLY answer to "which question is the settings panel
                // describing", and the raw accent at 40% alpha flattened to well
                // under 3:1 over paper — the block you were editing looked exactly
                // like the ones you weren't. Full alpha on the edge token so the
                // mark clears 1.4.11 in both themes; the `bg-primary/5` wash keeps
                // the soft fill it always had.
                i === selected ? 'bg-primary/5 shadow-[inset_0_0_0_1px_var(--primary-edge)]' : 'hover:bg-muted/40',
              )}
            >
              {step.type === 'reveal' ? (
                <RevealPageBlock step={step} onUpdate={(patch) => onUpdateStep(i, patch)} m={m} />
              ) : (
                <QuestionEditableBody
                  config={config}
                  step={step}
                  index={i}
                  accent={accent}
                  onUpdate={(patch) => onUpdateStep(i, patch)}
                  m={m}
                />
              )}
            </section>
          ))}

          {/* The page's ONE Submit — static chrome, exactly like the real form. */}
          <div className="px-6 py-6 sm:px-8">
            <button
              type="button"
              className="w-full rounded-xl px-6 py-3.5 text-sm font-semibold"
              style={{ background: accent, color: accentText }}
            >
              {m.canvas.submit}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The end reveal as a block ON the page canvas: compact, editable in place,
 * clearly not a question. It sits last (the layout anchors it there) and the
 * note says when it actually plays — after Submit, before the result.
 */
function RevealPageBlock({
  step,
  onUpdate,
  m,
}: {
  step: FormStep;
  onUpdate: (patch: Partial<FormStep>) => void;
  m: BuilderMessages;
}) {
  return (
    <div data-testid="page-reveal-block">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <i aria-hidden className="pi pi-sparkles" style={{ fontSize: 12 }} />
        {m.gallery.items.reveal.title}
      </p>
      <AutoTextarea
        value={step.reveal?.headline ?? ''}
        onChange={(v) => onUpdate({ reveal: { ...step.reveal, headline: v || null } })}
        placeholder={m.canvas.revealHeadlinePlaceholder}
        ariaLabel={m.canvas.revealHeadlinePlaceholder}
        className="canvas-title text-xl font-bold tracking-tight text-foreground"
      />
      <div className="mt-1">
        <AutoTextarea
          value={step.reveal?.subtitle ?? ''}
          onChange={(v) => onUpdate({ reveal: { ...step.reveal, subtitle: v || null } })}
          placeholder={m.canvas.revealSubtitlePlaceholder}
          ariaLabel={m.canvas.revealSubtitlePlaceholder}
          rows={1}
          className="text-sm leading-relaxed text-muted-foreground"
        />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        <i aria-hidden className="pi pi-info-circle" style={{ fontSize: 11 }} /> {m.canvas.revealVerticalNote}
      </p>
    </div>
  );
}

/**
 * The canvas mirror of the public `--pf-reveal-*` scales.
 *
 * Those are `clamp()` ranges keyed off the VIEWPORT, which is the one thing the
 * canvas cannot reuse: this card is ~640px wide inside a much wider admin
 * window, so a `vw` unit here would resolve against the browser rather than the
 * form. Each step is therefore stored as its two ends, and the preview picks the
 * one matching the device toggle — the desktop ceiling, or the phone floor.
 */
const REVEAL_MARK_PX = {
  sm: { desktop: 64, mobile: 44 },
  md: { desktop: 88, mobile: 56 },
  lg: { desktop: 128, mobile: 72 },
  xl: { desktop: 176, mobile: 88 },
} as const;
const REVEAL_TEXT_PX = {
  sm: { headline: 22, subtitle: 14 },
  md: { headline: 28, subtitle: 15 },
  lg: { headline: 40, subtitle: 18 },
  xl: { headline: 54, subtitle: 20 },
} as const;

/**
 * The reveal card, rendered as the respondent will see it: the configured
 * loader, the headline and subtitle at their configured scale, and the progress
 * bar filling over the configured duration — looping, so the author can feel how
 * long `durationMs` actually is.
 *
 * The copy is edited IN PLACE (same inline-textarea idiom as a question title),
 * which is why this mirrors the public `.pf-reveal__*` markup by hand instead of
 * mounting `<RevealScreen>`: that component owns its own timer and renders the
 * copy as static text, so it could preview the screen or let you edit it, not
 * both. The cost of that choice is this file having to track the public scales —
 * hence the two tables above, which mirror `public-form.css` value for value.
 * Duration and pre-warm stay in the settings panel.
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
  const { loader, loaderSize, textSize, accentBackground } = resolveRevealPresentation(step.reveal);
  // The RESPONDENT's fallbacks, not the editor's field labels. The canvas is a
  // preview of the published screen, so an unnamed side has to read the way it
  // will publish ("You"), never the way the input beside it is captioned
  // ("Your side's label") — that is the preview lying about the page.
  const r = getMessages(clientLocale()).renderer;
  // Same precedence as `resolveRevealCopy`: only an ABSENT value falls back, so
  // clearing the field previews the line actually disappearing.
  const versusStatus =
    step.reveal?.versusStatusLabel == null ? r.revealVersusStatus : step.reveal.versusStatusLabel;
  const mark = REVEAL_MARK_PX[loaderSize][device];
  // Clamped exactly as the stylesheet clamps it, so the biggest marks do not
  // preview with a halo the published page will not draw.
  const ring = Math.min(4, Math.max(1.5, mark * 0.025));
  const text = REVEAL_TEXT_PX[textSize];
  // The accent flood makes the card its own surface, so the copy has to flip
  // with it — the same pairing the public stylesheet makes with
  // `--pf-primary-contrast`.
  const onAccentColor = onAccent(accent);
  const bar = accentBackground ? onAccentColor : accent;
  const bodyColor = accentBackground ? onAccentColor : undefined;
  return (
    <div className="flex justify-center">
      <div
        data-testid="canvas-reveal-preview"
        data-pf-reveal-loader={loader}
        className={cn(
          'flex w-full flex-col items-center rounded-2xl border border-border px-6 py-14 shadow-xl sm:px-8',
          accentBackground ? '' : 'bg-card',
          device === 'mobile' ? 'max-w-[380px]' : 'max-w-[640px]',
        )}
        style={accentBackground ? { background: accent, color: onAccentColor } : undefined}
      >
        {loader === 'spinner' ? (
          <div
            aria-hidden
            data-testid="canvas-reveal-spinner"
            className="qb-reveal__spinner mb-7 rounded-full border-4 border-muted"
            style={{ width: mark, height: mark, borderTopColor: bar }}
          />
        ) : null}
        <AutoTextarea
          value={step.reveal?.headline ?? ''}
          onChange={(v) => onUpdate({ reveal: { ...step.reveal, headline: v || null } })}
          placeholder={m.canvas.revealHeadlinePlaceholder}
          ariaLabel={m.canvas.revealHeadlinePlaceholder}
          className="canvas-title max-w-[420px] text-center font-extrabold leading-tight tracking-tight text-foreground"
          style={{ fontSize: text.headline, color: bodyColor }}
        />
        <div className="mt-2 w-full max-w-[420px]">
          <AutoTextarea
            value={step.reveal?.subtitle ?? ''}
            onChange={(v) => onUpdate({ reveal: { ...step.reveal, subtitle: v || null } })}
            placeholder={m.canvas.revealSubtitlePlaceholder}
            ariaLabel={m.canvas.revealSubtitlePlaceholder}
            rows={2}
            className="text-center leading-relaxed text-muted-foreground"
            style={{ fontSize: text.subtitle, color: bodyColor }}
          />
        </div>
        {loader === 'spinner' || loader === 'bar' ? (
          <div className="mt-6 h-2 w-[260px] max-w-full overflow-hidden rounded-full bg-muted">
            <div
              className="qb-reveal__fill h-full rounded-full"
              style={{ background: bar, animationDuration: `${durationMs}ms` }}
            />
          </div>
        ) : null}
        {loader === 'versus' ? (
          <div
            aria-hidden
            data-testid="canvas-reveal-versus"
            className="mt-6 flex w-full items-start justify-center gap-5"
            // The same ink/paper poles the public stylesheet derives, so the
            // card previews the pairing that will publish rather than a
            // grey-on-grey approximation of it.
            style={
              {
                '--pf-mark-ink': `color-mix(in srgb, ${accent} 12%, #05070a)`,
                '--pf-mark-paper': `color-mix(in srgb, ${accent} 8%, #ffffff)`,
              } as React.CSSProperties
            }
          >
            <div className="flex flex-col items-center gap-3">
              <div
                className="flex items-center justify-center rounded-full"
                style={{
                  width: mark,
                  height: mark,
                  background: 'var(--pf-mark-ink)',
                  color: 'var(--pf-mark-paper)',
                  boxShadow: `0 0 0 ${ring}px color-mix(in srgb, var(--pf-mark-paper) 55%, transparent)`,
                }}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  style={{ width: '62%', height: '62%' }}
                  aria-hidden
                >
                  <circle cx="12" cy="8" r="3.6" />
                  <path d="M12 13.2c-3.6 0-6.4 2.1-6.4 4.7v1.3h12.8v-1.3c0-2.6-2.8-4.7-6.4-4.7Z" />
                </svg>
              </div>
              <span className="max-w-[12ch] text-center text-[14px] font-bold">
                {step.reveal?.versusYouLabel || r.revealVersusYou}
              </span>
            </div>
            <div
              className="flex max-w-[200px] flex-1 flex-col items-center gap-2.5"
              style={{ paddingTop: mark * 0.24 }}
            >
              <span className="text-[19px] font-extrabold leading-none tracking-tight">
                100<span className="align-[0.12em] text-[0.55em] font-bold">%</span>
              </span>
              <div
                className="h-2.5 w-full overflow-hidden rounded-full"
                style={{ background: 'color-mix(in srgb, var(--pf-mark-ink) 22%, transparent)' }}
              >
                <div
                  className="qb-reveal__fill h-full rounded-full"
                  style={{
                    background: `linear-gradient(90deg, var(--pf-mark-ink), ${bar})`,
                    animationDuration: `${durationMs}ms`,
                  }}
                />
              </div>
            </div>
            <div className="flex flex-col items-center gap-3">
              <div
                className="flex items-center justify-center rounded-full font-bold"
                style={{
                  width: mark,
                  height: mark,
                  fontSize: mark * 0.44,
                  background: 'var(--pf-mark-paper)',
                  color: 'var(--pf-mark-ink)',
                  boxShadow: `0 0 0 ${ring}px color-mix(in srgb, var(--pf-mark-paper) 55%, transparent)`,
                }}
              >
                ?
              </div>
              <span className="max-w-[12ch] text-center text-[14px] font-bold">
                {step.reveal?.versusMatchLabel || r.revealVersusMatch}
              </span>
              {versusStatus ? (
                <span
                  className="-mt-1.5 max-w-[14ch] text-center text-[13px]"
                  style={{ color: 'color-mix(in srgb, currentColor 55%, transparent)' }}
                >
                  {versusStatus}
                </span>
              ) : null}
            </div>
          </div>
        ) : null}
        <p className="mt-5 text-xs text-muted-foreground" style={{ color: bodyColor }}>
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
