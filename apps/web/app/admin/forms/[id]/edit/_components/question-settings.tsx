'use client';

import { useEffect, useMemo, useState } from 'react';
import type { FormStep, FormLayout } from '@quill/engine';
import {
  clampSliderValue,
  defaultFlowGroup,
  nameFields,
  resolveOptionLayout,
  sanitizeStepKey,
  sliderBounds,
  sliderHasNoTravel,
} from '@quill/engine';
import { COUNTRIES, countryName, getMessages } from '@quill/shared';
import { clientLocale } from '@/lib/client-locale';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Select, type SelectOption } from '@/components/ui/select';
import { useConfirmDialog } from '@/components/ui/confirm-dialog';
import { Field, NumberField, SelectField, InlineField, TextField, SegmentedToggle } from './fields';
import { OptionsEditor } from './options-editor';
import { SliderScoringEditor } from './slider-scoring-editor';
import { maxScoreForSteps } from './scoring-util';
import { LogicRules } from './logic-rules';
import { LogicConditions } from './logic-conditions';
import { QuestionVariants } from './question-variants';
import { QuestionHubspotSection } from './question-hubspot';
import { SchedulerPanel } from './scheduler-panel';
import { tokenOptionsBefore } from './token-textarea';
import { HelpTip } from '@/components/ui/help-tip';
import {
  GALLERY,
  GALLERY_GROUPS,
  hasOptions,
  isContactType,
  isInputlessType,
  type GalleryItem,
} from './question-types';
import type { EditorMessages } from './messages';
import type { BuilderMessages } from './builder-messages';

const ALL_ITEMS: GalleryItem[] = GALLERY_GROUPS.flatMap((g) => GALLERY[g]);

/** The reveal card's play-time bounds — mirrors `formRevealSchema`. */
const DEFAULT_REVEAL_MS = 2200;
const MIN_REVEAL_MS = 500;
const MAX_REVEAL_MS = 30_000;

/** Shared look for the inline slider-bounds warnings (V5-A2). */
const sliderWarnClass =
  'flex items-start gap-1.5 rounded-md bg-destructive/10 px-2 py-1 text-[11px] leading-relaxed text-destructive';

/** Match a step to its gallery item id (so the type <select> reflects single vs multiple). */
function currentItemId(step: FormStep): string {
  if (step.type === 'multiple_choice') return step.selectionMode === 'multiple' ? 'multiple' : 'single';
  return ALL_ITEMS.find((it) => it.type === step.type && !it.selectionMode)?.id ?? step.type;
}

/**
 * The right contextual pane: type (swap), Required, type-specific options
 * (choices+points, slider bounds+scoring, email/phone rules), then
 * progressive-disclosure Logic (forward rules) and Scoring. Contact fields show
 * the "doesn't affect the score" hint instead of scoring.
 */
export function QuestionSettings({
  step,
  index,
  steps,
  layout = 'slides',
  scoringEnabled,
  onUpdate,
  onDelete,
  bm,
  em,
  formId,
  locale,
  onOpenConnect,
  revealAfter,
  onRevealAfterChange,
  onRenameKey,
}: {
  step: FormStep;
  index: number;
  steps: FormStep[];
  /** The form's presentation layout — a reveal behaves differently on vertical. */
  layout?: FormLayout;
  scoringEnabled: boolean;
  onUpdate: (patch: Partial<FormStep>) => void;
  onDelete: () => void;
  bm: BuilderMessages;
  em: EditorMessages;
  formId: string;
  locale: string;
  /** Switch the editor to the Connect tab (HubSpot destination setup). */
  onOpenConnect: () => void;
  /** Whether the step right after this one is already a reveal card. */
  revealAfter: boolean;
  /** Insert (or remove) a reveal card immediately after this question. */
  onRevealAfterChange: (on: boolean) => void;
  /** Rename this step's answer key, cascading every reference — V5-A10. */
  onRenameKey: (nextKey: string) => void;
}) {
  const contact = isContactType(step.type);
  // Form-wide "highest possible" total (same math as Results). Drives the
  // "assign points" nudge when scoring is on but nothing scores yet.
  const scoringMax = maxScoreForSteps(steps);
  const { confirm: confirmDialog, dialog } = useConfirmDialog();
  // Does THIS question contribute points right now? Both switches must be on
  // (V5-B2), and it drives whether the point inputs are worth rendering at all.
  const stepScores = scoringEnabled && step.scoringEnabled !== false;

  // Slider bounds sanity (V5-A2). `sliderBounds` normalizes an inverted pair, so
  // compare against the RAW values to tell "max below min" from a valid range.
  const { min: sliderMin, max: sliderMax } = sliderBounds(step);
  const sliderMaxBelowMin = step.type === 'slider' && (step.max ?? 100) < (step.min ?? 0);
  // min === max is the boundary of the same mistake: a handle with nowhere to go.
  const sliderNoTravel = step.type === 'slider' && !sliderMaxBelowMin && sliderHasNoTravel(step);
  // A non-positive step is invalid HTML on <input type=range>; browsers fall
  // back to 1, so the configured granularity is silently ignored.
  const sliderStepInvalid = step.type === 'slider' && step.step != null && step.step <= 0;
  const sliderDefaultOutOfRange =
    step.type === 'slider' &&
    step.default != null &&
    (step.default < sliderMin || step.default > sliderMax);

  // Country options for the phone step's default-country picker: an "automatic"
  // (locale-based) row first, then every country sorted by localized name.
  const countryOptions = useMemo<SelectOption[]>(
    () => [
      { value: '', label: em.props.phoneDefaultCountryAuto },
      ...[...COUNTRIES]
        .sort((a, b) => countryName(a.code, locale).localeCompare(countryName(b.code, locale), locale))
        .map((c) => ({ value: c.code, label: `${c.flag} ${countryName(c.code, locale)} (${c.dial})` })),
    ],
    [locale, em.props.phoneDefaultCountryAuto],
  );

  function changeType(itemId: string) {
    const item = ALL_ITEMS.find((it) => it.id === itemId);
    if (!item) return;
    const patch: Partial<FormStep> = { type: item.type, flowGroup: defaultFlowGroup(item.type) };
    if (item.type === 'multiple_choice') patch.selectionMode = item.selectionMode ?? 'single';
    else patch.selectionMode = undefined;
    if (hasOptions(item.type) && (step.options ?? []).length === 0) {
      patch.options = [{ label: 'Option 1', value: 'option_1', points: 0 }];
    }
    if (item.type === 'slider' && step.min == null) {
      patch.min = 0;
      patch.max = 100;
      patch.step = 1;
      patch.default = 50;
    }
    // Leaving a choice type drops choice-only forward rules (nothing to match on).
    if (!hasOptions(item.type) && step.goto) patch.goto = undefined;
    onUpdate(patch);
  }

  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto border-l border-border p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">{bm.settings.title}</h2>
        <Button
          variant="ghost"
          size="icon"
          aria-label={bm.settings.delete}
          onClick={() => {
            void confirmDialog({
              title: getMessages(clientLocale()).dialog.deleteQuestionTitle,
              message: bm.settings.deleteConfirm,
              confirmLabel: bm.settings.delete,
              destructive: true,
            }).then((ok) => {
              if (ok) onDelete();
            });
          }}
          className="text-muted-foreground hover:text-destructive"
        >
          <i aria-hidden className="pi pi-trash" style={{ fontSize: 13 }} />
        </Button>
      </div>

      <Field label={bm.settings.questionType}>
        <SelectField value={currentItemId(step)} onChange={(e) => changeType(e.target.value)}>
          {ALL_ITEMS.map((it) => (
            <option key={it.id} value={it.id}>
              {bm.gallery.items[it.id].title}
            </option>
          ))}
        </SelectField>
      </Field>

      {!isInputlessType(step.type) ? (
        <InlineField label={bm.settings.required}>
          <Switch
            checked={step.required !== false}
            onCheckedChange={(v) => onUpdate({ required: v })}
            aria-label={bm.settings.required}
          />
        </InlineField>
      ) : null}

      {/* Type-specific: options, then the scoring switch that controls whether
          the Points column even applies (V5-B6). The switch used to sit in its
          own section at the very BOTTOM of the panel, far below the Points
          column it governs — so the column was visible with no nearby
          explanation of what turns it on. Options → their scoring, together. */}
      {hasOptions(step.type) ? (
        <section className="flex flex-col gap-3 border-t border-border pt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {bm.settings.options}
          </p>
          {step.type === 'multiple_choice' ? (
            <InlineField label={bm.settings.optionLayout} hint={bm.settings.optionLayoutHint}>
              <SegmentedToggle
                value={resolveOptionLayout(step)}
                onChange={(optionLayout) => onUpdate({ optionLayout })}
                options={[
                  { value: 'list' as const, label: bm.settings.optionLayoutList },
                  { value: 'cards' as const, label: bm.settings.optionLayoutCards },
                ]}
                ariaLabel={bm.settings.optionLayout}
              />
            </InlineField>
          ) : null}
          <OptionsEditor
            options={step.options ?? []}
            onChange={(options) => onUpdate({ options })}
            showPoints={stepScores}
            showIcon={step.type === 'multiple_choice'}
            layout={resolveOptionLayout(step)}
            m={em.options}
          />
          <div className="border-t border-border/60 pt-3">
            <StepScoringToggle
              step={step}
              formScoringEnabled={scoringEnabled}
              scoringMax={scoringMax}
              onUpdate={onUpdate}
              bm={bm}
            />
          </div>
        </section>
      ) : null}

      {step.type === 'reveal' ? (
        <section className="flex flex-col gap-3 border-t border-border pt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {bm.settings.revealSection}
          </p>
          <p className="text-xs text-muted-foreground">{bm.settings.revealHint}</p>
          <Field label={bm.settings.revealHeadline}>
            <TextField
              value={step.reveal?.headline ?? ''}
              data-testid="step-reveal-headline"
              onChange={(e) => onUpdate({ reveal: { ...step.reveal, headline: e.target.value || null } })}
            />
          </Field>
          <Field label={bm.settings.revealSubtitle}>
            <TextField
              value={step.reveal?.subtitle ?? ''}
              data-testid="step-reveal-subtitle"
              onChange={(e) => onUpdate({ reveal: { ...step.reveal, subtitle: e.target.value || null } })}
            />
          </Field>
          <Field label={bm.settings.revealDuration} hint={bm.settings.revealDurationHint}>
            <NumberField
              aria-label={bm.settings.revealDuration}
              value={step.reveal?.durationMs ?? DEFAULT_REVEAL_MS}
              min={MIN_REVEAL_MS}
              max={MAX_REVEAL_MS}
              step={100}
              data-testid="step-reveal-duration"
              onChange={(e) => {
                // The schema bounds this at 500..30000; clamp so a stray
                // keystroke cannot fail the whole form's autosave.
                const n = Number(e.target.value);
                onUpdate({
                  reveal: {
                    ...step.reveal,
                    durationMs: Number.isFinite(n)
                      ? Math.min(MAX_REVEAL_MS, Math.max(MIN_REVEAL_MS, Math.round(n)))
                      : DEFAULT_REVEAL_MS,
                  },
                });
              }}
            />
          </Field>
          {/* Carried over from the Design panel this card replaced: warm the
              outcome's booking embed while the interstitial plays. */}
          <InlineField label={bm.settings.revealPrewarm} hint={bm.settings.revealPrewarmHint}>
            <Switch
              checked={!!step.reveal?.prewarm}
              onCheckedChange={(v) =>
                onUpdate({ reveal: { ...step.reveal, prewarm: v || undefined } })
              }
              aria-label={bm.settings.revealPrewarm}
            />
          </InlineField>
        </section>
      ) : null}

      {step.type === 'scheduler' ? (
        <SchedulerPanel
          scheduler={step.scheduler ?? { provider: 'calendly', prefill: true }}
          onChange={(sc) => onUpdate({ scheduler: sc })}
          // Only answers captured BEFORE this step can prefill the booking form.
          fields={tokenOptionsBefore(
            steps,
            steps.findIndex((s) => s.key === step.key),
          )}
          // Only steps AFTER this one are legal forward jump targets.
          laterSteps={steps
            .slice(steps.findIndex((s) => s.key === step.key) + 1)
            .map((s) => ({ key: s.key, label: s.question?.trim() || s.key }))}
          goto={step.goto}
          onGotoChange={(g) => onUpdate({ goto: g })}
          bm={bm}
        />
      ) : null}

      {step.type === 'slider' ? (
        <section className="flex flex-col gap-3 border-t border-border pt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{em.types.slider}</p>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label={em.props.sliderMin}>
              <NumberField
                aria-label={em.props.sliderMin}
                value={step.min ?? 0}
                onChange={(e) => onUpdate({ min: Number(e.target.value) || 0 })}
              />
            </Field>
            <Field label={em.props.sliderMax}>
              <NumberField
                aria-label={em.props.sliderMax}
                value={step.max ?? 100}
                onChange={(e) => onUpdate({ max: Number(e.target.value) || 0 })}
              />
            </Field>
            <Field label={em.props.sliderStep}>
              <NumberField
                aria-label={em.props.sliderStep}
                value={step.step ?? 1}
                onChange={(e) => onUpdate({ step: Number(e.target.value) || 1 })}
              />
            </Field>
            <Field label={em.props.sliderDefault}>
              <NumberField
                aria-label={em.props.sliderDefault}
                value={step.default ?? 0}
                onChange={(e) => onUpdate({ default: Number(e.target.value) || 0 })}
              />
            </Field>
          </div>
          {/* Bounds are advisory, not enforced on keystroke: clamping mid-typing
              eats digits ("878" against a max of 5 would stick at 5). The value
              is clamped where it becomes geometry instead — V5-A2. */}
          {sliderMaxBelowMin ? (
            <p role="alert" data-testid="slider-max-below-min" className={sliderWarnClass}>
              <i aria-hidden className="pi pi-exclamation-triangle mt-0.5 shrink-0" style={{ fontSize: 10 }} />
              {em.props.sliderMaxBelowMin}
            </p>
          ) : null}
          {sliderNoTravel ? (
            <p role="alert" data-testid="slider-no-travel" className={sliderWarnClass}>
              <i aria-hidden className="pi pi-exclamation-triangle mt-0.5 shrink-0" style={{ fontSize: 10 }} />
              {em.props.sliderNoTravel.replaceAll('{min}', String(sliderMin))}
            </p>
          ) : null}
          {sliderStepInvalid ? (
            <p role="alert" data-testid="slider-step-invalid" className={sliderWarnClass}>
              <i aria-hidden className="pi pi-exclamation-triangle mt-0.5 shrink-0" style={{ fontSize: 10 }} />
              {em.props.sliderStepInvalid}
            </p>
          ) : null}
          {sliderDefaultOutOfRange ? (
            <p role="alert" data-testid="slider-default-out-of-range" className={sliderWarnClass}>
              <i aria-hidden className="pi pi-exclamation-triangle mt-0.5 shrink-0" style={{ fontSize: 10 }} />
              {em.props.sliderDefaultOutOfRange
                .replaceAll('{min}', String(sliderMin))
                .replaceAll('{max}', String(sliderMax))
                .replaceAll('{shown}', String(clampSliderValue(step, step.default ?? sliderMin)))}
            </p>
          ) : null}
        </section>
      ) : null}

      {step.type === 'email' ? (
        <section className="border-t border-border pt-4">
          <InlineField label={em.props.corporateEmailOnly} hint={em.props.corporateEmailHint}>
            <Switch
              checked={!!step.corporateEmailOnly}
              onCheckedChange={(v) => onUpdate({ corporateEmailOnly: v || undefined })}
              aria-label={em.props.corporateEmailOnly}
            />
          </InlineField>
        </section>
      ) : null}

      {step.type === 'phone' ? (
        <section className="flex flex-col gap-3 border-t border-border pt-4">
          <Field
            label={em.props.phoneMinDigits}
            labelAdornment={
              <HelpTip text={em.props.phoneMinDigitsHelp} label={em.props.phoneMinDigits} side="bottom" />
            }
          >
            <NumberField
              value={step.phoneMinDigits ?? 7}
              min={1}
              onChange={(e) => onUpdate({ phoneMinDigits: Number(e.target.value) || undefined })}
            />
          </Field>
          <Field label={em.props.phoneDefaultCountry}>
            <Select
              ariaLabel={em.props.phoneDefaultCountry}
              value={step.phoneDefaultCountry ?? ''}
              options={countryOptions}
              searchable
              locale={locale}
              onChange={(v) => onUpdate({ phoneDefaultCountry: v || undefined })}
            />
          </Field>
        </section>
      ) : null}

      {/* Name step: the two collected fields + their placeholders */}
      {step.type === 'name' ? (
        <section className="flex flex-col gap-3 border-t border-border pt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {em.nameStep.title}
          </p>
          <p className="text-xs text-muted-foreground">{em.nameStep.hint}</p>
          <NameFieldsEditor
            step={step}
            onUpdate={onUpdate}
            m={em.nameStep}
            placeholderDefaults={[bm.canvas.nameFirstPlaceholder, bm.canvas.nameLastPlaceholder]}
          />
        </section>
      ) : null}

      {/* Logic — forward rules (choice/dropdown only) */}
      {hasOptions(step.type) ? (
        <section className="flex flex-col gap-3 border-t border-border pt-4">
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <i aria-hidden className="pi pi-sitemap text-secondary" style={{ fontSize: 11 }} />
              {bm.settings.logic}
            </p>
          </div>
          {(step.goto?.length ?? 0) === 0 ? (
            <p className="text-xs text-muted-foreground">{bm.settings.noRules}</p>
          ) : null}
          <LogicRules step={step} index={index} steps={steps} onUpdate={onUpdate} m={bm} />
        </section>
      ) : null}

      {/* Visibility — declarative show/hide conditions + personal-email branch */}
      <section className="flex flex-col gap-3 border-t border-border pt-4">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <i aria-hidden className="pi pi-eye text-secondary" style={{ fontSize: 11 }} />
          {em.logic.title}
        </p>
        <LogicConditions step={step} index={index} steps={steps} onUpdate={onUpdate} m={em.logic} />
        {/* Personal-email branch needs an earlier email answer — impossible on
            the first question, so hide it there. A reveal is skipped or played
            by the plain conditions above; a second, narrower visibility rule on
            an interstitial was a control that looked meaningful and wasn't. */}
        {step.type !== 'email' && step.type !== 'reveal' && index > 0 ? (
          <InlineField label={em.logic.personalEmailOnly} hint={em.logic.personalEmailHint}>
            <Switch
              checked={!!step.showForPersonalEmailOnly}
              onCheckedChange={(v) => onUpdate({ showForPersonalEmailOnly: v || undefined })}
              aria-label={em.logic.personalEmailOnly}
            />
          </InlineField>
        ) : null}
      </section>

      {/* Dynamic question — vary the text by an earlier answer. Variants swap the
          step's `question`, which a reveal never renders: it shows its own
          headline and subtitle, and BOTH already interpolate `[key]` tokens. So
          the section is dropped there rather than editing a field the respondent
          will never see. */}
      {step.type === 'reveal' ? null : (
        <section className="flex flex-col gap-3 border-t border-border pt-4">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <i aria-hidden className="pi pi-sync text-secondary" style={{ fontSize: 11 }} />
            {em.variants.title}
          </p>
          <QuestionVariants step={step} index={index} steps={steps} onUpdate={onUpdate} m={em.variants} />
        </section>
      )}

      {/* Behavior — terminal (disqualify) + reveal position (V4-04/V4-12) */}
      <section className="flex flex-col gap-1 border-t border-border pt-4">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {em.behavior.title}
        </p>
        {/* "Ends the form" means DISQUALIFICATION here, which is the opposite of
            what finishing a scheduler means — booking is the success case. A
            scheduler routes from its own "After booking" picker instead. A
            reveal is a pause on the way somewhere, never a verdict, so it is
            excluded for the same reason. */}
        {step.type !== 'scheduler' && step.type !== 'reveal' ? (
          <InlineField label={em.behavior.terminal} hint={em.behavior.terminalHint}>
            <Switch
              checked={!!step.terminal}
              onCheckedChange={(v) => onUpdate({ terminal: v || undefined })}
              aria-label={em.behavior.terminal}
            />
          </InlineField>
        ) : null}
        {/* Hidden question — never shown; its answer is seeded from a matching
            URL parameter and carried into the submission. Meaningless for a
            message step (it collects no answer) and for a scheduler (its answer
            is a booking, which no URL parameter can make), so hide it there. */}
        {!isInputlessType(step.type) && step.type !== 'scheduler' ? (
          <InlineField label={em.behavior.hidden} hint={em.behavior.hiddenHint}>
            <Switch
              checked={!!step.hidden}
              onCheckedChange={(v) => onUpdate({ hidden: v || undefined })}
              aria-label={em.behavior.hidden}
            />
          </InlineField>
        ) : null}
        {/* The answer's field key (V5-A10). The hidden-question hint above talks
            about "a matching URL parameter" — this is the only place that says
            WHICH one. `name` steps edit their two subfield keys in their own
            section instead, and a `message` step captures nothing to key. */}
        {!isInputlessType(step.type) && step.type !== 'name' && step.type !== 'scheduler' ? (
          <FieldKeyEditor
            stepKey={step.key}
            // Every answer slot the engine's renameStepKey refuses to collide
            // with: each other step's key, PLUS a name step's subfield keys
            // (firstname/lastname), which are real answer slots even though the
            // name step never stores under its own key. Without the subfields the
            // UI thought "firstname" was free, called rename, the engine refused
            // it as a no-op, and the field showed the rejected key with no error
            // (V4-12/13).
            taken={steps
              .filter((s) => s.key !== step.key)
              .flatMap((s) => (s.type === 'name' ? [s.key, ...nameFields(s)] : [s.key]))}
            onRename={onRenameKey}
            m={em.behavior}
          />
        ) : null}
        {/* Shortcut for "play a reveal right after this one": it INSERTS a real
            reveal card after this question (and removing it deletes that card),
            so the switch and the question list can never disagree. A reveal
            after a HIDDEN question never plays — the respondent never completes
            the step it follows — so the pair isn't offered (V5-QA). Nor after a
            reveal: back-to-back interstitials are never what an author means. */}
        {/* On VERTICAL the switch is not offered at all: "after this question"
            is a position, and the one-page reveal has none — it plays once,
            after Submit. Its switch lives in Design, next to the layout picker
            (impossible-combination rule: don't offer a control that lies). */}
        {step.hidden || step.type === 'reveal' || layout === 'vertical' ? null : (
          <InlineField label={em.behavior.reveal} hint={em.behavior.revealHint}>
            <Switch
              checked={revealAfter}
              onCheckedChange={onRevealAfterChange}
              data-testid="behavior-reveal-after"
              aria-label={em.behavior.reveal}
            />
          </InlineField>
        )}
      </section>

      {/* Contact hint, and the SLIDER's scoring (its ranges live here, not in the
          Options section above, because a slider has no options). Choice types
          render their scoring switch inside Options — see V5-B6 above. Free-text
          types render nothing: there is nowhere to put points (V5-A11). */}
      {contact || step.type === 'slider' ? (
        <section className="border-t border-border pt-4">
          {contact ? (
            <p className="text-xs text-muted-foreground">{bm.settings.contactHint}</p>
          ) : (
            <>
              <StepScoringToggle
                step={step}
                formScoringEnabled={scoringEnabled}
                scoringMax={scoringMax}
                onUpdate={onUpdate}
                bm={bm}
              />
              {stepScores ? (
                <div className="mt-3">
                  <SliderScoringEditor
                    step={step}
                    ranges={step.sliderScoring ?? []}
                    onChange={(sliderScoring) => onUpdate({ sliderScoring })}
                    m={em.sliderScoring}
                  />
                </div>
              ) : null}
            </>
          )}
        </section>
      ) : null}

      {/* HubSpot — map this answer to a contact property (message steps
          collect no answer, so there is nothing to map). */}
      {!isInputlessType(step.type) ? (
        <QuestionHubspotSection
          formId={formId}
          stepKey={step.key}
          locale={locale}
          onOpenConnect={onOpenConnect}
          m={bm.hubspot}
        />
      ) : null}
      {dialog}
    </div>
  );
}

/**
 * This question's scoring switch (V5-B2), rendered next to whatever it governs —
 * the option Points column for a choice step, the range table for a slider.
 *
 * It edits `step.scoringEnabled`, the SAME flag the Results list toggles, and is
 * disabled (explaining why) while the form-level switch is off, since nothing
 * scores then regardless.
 */
function StepScoringToggle({
  step,
  formScoringEnabled,
  scoringMax,
  onUpdate,
  bm,
}: {
  step: FormStep;
  formScoringEnabled: boolean;
  /** Form-wide highest possible total — drives the "assign points yet?" nudge. */
  scoringMax: number;
  onUpdate: (patch: Partial<FormStep>) => void;
  bm: BuilderMessages;
}) {
  const on = formScoringEnabled && step.scoringEnabled !== false;
  return (
    <>
      <InlineField label={bm.settings.scoring}>
        <Switch
          checked={on}
          disabled={!formScoringEnabled}
          onCheckedChange={(v) => onUpdate({ scoringEnabled: v ? undefined : false })}
          aria-label={bm.settings.scoring}
          data-testid="step-scoring-toggle"
        />
      </InlineField>
      <p className="mt-1 text-xs text-muted-foreground">
        {formScoringEnabled ? bm.settings.scoringHint : bm.settings.scoringFormOff}
      </p>
      {on && scoringMax === 0 ? (
        <p data-testid="scoring-zero-hint" className="mt-1.5 flex items-start gap-1.5 text-xs text-muted-foreground">
          <i aria-hidden className="pi pi-info-circle mt-0.5 text-secondary" style={{ fontSize: 11 }} />
          {bm.settings.scoringZeroHint}
        </p>
      ) : null}
    </>
  );
}

/**
 * The step's answer field key, editable in place (V5-A10).
 *
 * Local text state so typing is never fought by the sanitizer, committing on
 * blur or Enter — a rename rewrites pointers across the whole config, so doing
 * it per keystroke would churn the form (and the autosave) on the way to a name.
 * A key that collides with another question is refused with a message instead of
 * being silently mangled into a unique variant.
 */
function FieldKeyEditor({
  stepKey,
  taken,
  onRename,
  m,
}: {
  stepKey: string;
  taken: string[];
  onRename: (nextKey: string) => void;
  m: EditorMessages['behavior'];
}) {
  const [text, setText] = useState(stepKey);
  /** Why the last attempt was refused — a silent revert looks like a bug. */
  const [refused, setRefused] = useState<'taken' | 'empty' | null>(null);
  // Follow an external change (switching questions, or an undo).
  useEffect(() => {
    setText(stepKey);
    setRefused(null);
  }, [stepKey]);
  const clean = sanitizeStepKey(text);
  const collides = clean !== stepKey && taken.includes(clean);
  // Punctuation-only input sanitizes to "_" or "", neither of which is a key
  // anyone meant to type — refuse it rather than committing a mystery.
  const meaningless = !clean || /^_+$/.test(clean);

  function commit() {
    if (clean === stepKey) {
      setText(stepKey);
      setRefused(null);
      return;
    }
    if (meaningless) {
      setText(stepKey);
      setRefused('empty');
      return;
    }
    if (collides) {
      setText(stepKey);
      setRefused('taken');
      return;
    }
    setRefused(null);
    onRename(clean);
  }

  return (
    <div className="mt-2 flex flex-col gap-1">
      <span className="text-[11px] font-medium text-muted-foreground">{m.fieldKey}</span>
      <TextField
        value={text}
        data-testid="step-field-key"
        aria-label={m.fieldKey}
        aria-invalid={collides || refused != null || undefined}
        maxLength={64}
        onChange={(e) => {
          setText(e.target.value);
          setRefused(null);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            // Commit WITHOUT blurring: `blur()` dropped focus onto <body>, so a
            // keyboard user lost their place and had to Tab back from the top.
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            setText(stepKey);
            setRefused(null);
          }
        }}
        className="h-8 py-1 font-mono text-xs"
      />
      {collides || refused ? (
        <p role="alert" data-testid="step-field-key-taken" className="text-[11px] text-destructive">
          {collides || refused === 'taken' ? m.fieldKeyTaken : m.fieldKeyInvalid}
        </p>
      ) : (
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          {m.fieldKeyHint} <span className="font-mono">{m.fieldKeyUrlExample.replace('{key}', stepKey)}</span>
        </p>
      )}
    </div>
  );
}

/**
 * The `name` step's two sub-fields: each row edits the answer field key
 * (sanitized live so a saved key is always schema-valid) and its placeholder.
 * Placeholders follow a renamed key so no configured copy is orphaned.
 */
function NameFieldsEditor({
  step,
  onUpdate,
  m,
  placeholderDefaults,
}: {
  step: FormStep;
  onUpdate: (patch: Partial<FormStep>) => void;
  m: EditorMessages['nameStep'];
  /** Localized defaults ("First name"/"Last name") shown as the input
   *  placeholders — what ships when the builder leaves the field empty. */
  placeholderDefaults: [string, string];
}) {
  const defaults = ['firstname', 'lastname'];
  const fields = [step.fields?.[0] ?? defaults[0]!, step.fields?.[1] ?? defaults[1]!];
  const placeholders = step.placeholders ?? {};

  function setFieldKey(i: number, raw: string) {
    // Lighter than `slugify` (no trailing-underscore trim) so multi-word typing
    // isn't eaten mid-keystroke; empty falls back to the default key.
    const key = raw.toLowerCase().replace(/[^a-z0-9_]+/g, '_').slice(0, 64) || defaults[i]!;
    const old = fields[i]!;
    const next = [...fields];
    next[i] = key;
    const patch: Partial<FormStep> = {
      fields: next[0] === defaults[0] && next[1] === defaults[1] ? undefined : next,
    };
    if (old !== key && placeholders[old] != null) {
      const moved = { ...placeholders, [key]: placeholders[old]! };
      delete moved[old];
      patch.placeholders = Object.keys(moved).length ? moved : undefined;
    }
    onUpdate(patch);
  }

  function setPlaceholder(field: string, text: string) {
    const next = { ...placeholders };
    if (text) next[field] = text;
    else delete next[field];
    onUpdate({ placeholders: Object.keys(next).length ? next : undefined });
  }

  return (
    <div className="flex flex-col gap-2.5">
      {fields.map((field, i) => (
        <div key={i} className="flex flex-col gap-2 rounded-lg border border-border bg-background p-2.5">
          <span className="text-[11px] font-medium text-muted-foreground">
            {i === 0 ? m.first : m.second}
          </span>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-muted-foreground">{m.fieldKey}</span>
            <TextField
              value={field}
              onChange={(e) => setFieldKey(i, e.target.value)}
              className="h-8 py-1 font-mono text-xs"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-muted-foreground">{m.placeholder}</span>
            <TextField
              value={placeholders[field] ?? ''}
              onChange={(e) => setPlaceholder(field, e.target.value)}
              placeholder={placeholderDefaults[i]}
              data-testid={`name-placeholder-${i}`}
              className="h-8 py-1 text-xs"
            />
          </label>
        </div>
      ))}
      <p className="text-[10px] leading-relaxed text-muted-foreground" data-testid="name-fieldkey-hint">
        {m.fieldKeyHint}
      </p>
    </div>
  );
}
