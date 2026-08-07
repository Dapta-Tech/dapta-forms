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
import { LogicDialog } from './logic-dialog';
import { describeCondition, liveGotoRules, liveRuleCount, optionLabel, splitGoto } from './logic-util';
import { QuestionHubspotSection } from './question-hubspot';
import { QuestionVariants } from './question-variants';
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
import { AdvancedSettings, PrefillRow } from './advanced-settings';
import { tb } from './builder-messages';
import type { BuilderMessages } from './builder-messages';

const ALL_ITEMS: GalleryItem[] = GALLERY_GROUPS.flatMap((g) => GALLERY[g]);

/** The reveal card's play-time bounds — mirrors `formRevealSchema`. */
const DEFAULT_REVEAL_MS = 2200;
const MIN_REVEAL_MS = 500;
const MAX_REVEAL_MS = 30_000;

/** Shared look for the inline slider-bounds warnings (V5-A2). */
const sliderWarnClass =
  'flex items-start gap-1.5 rounded-md bg-destructive/10 px-2 py-1 text-xs leading-relaxed text-destructive';

/** Match a step to its gallery item id (so the type <select> reflects single vs multiple). */
function currentItemId(step: FormStep): string {
  if (step.type === 'multiple_choice') return step.selectionMode === 'multiple' ? 'multiple' : 'single';
  return ALL_ITEMS.find((it) => it.type === step.type && !it.selectionMode)?.id ?? step.type;
}

/**
 * The right contextual pane: type (swap), Required, type-specific options
 * (choices+points, slider bounds+scoring, email/phone rules), then the
 * always-visible {@link LogicCard} — what this question's rules SAY, with the
 * shared dialog one click away — and the collapsed Advanced group. Contact
 * fields show the "doesn't affect the score" hint instead of scoring.
 */
export function QuestionSettings({
  formId,
  step,
  index,
  steps,
  layout = 'slides',
  scoringEnabled,
  onUpdate,
  onDelete,
  bm,
  em,
  locale,
  revealAfter,
  onRevealAfterChange,
  onRenameKey,
  publicUrl,
  onOpenConnect,
}: {
  formId: string;
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
  locale: string;
  /** Whether the step right after this one is already a reveal card. */
  revealAfter: boolean;
  /** Insert (or remove) a reveal card immediately after this question. */
  onRevealAfterChange: (on: boolean) => void;
  /** Rename this step's answer key, cascading every reference — V5-A10. */
  onRenameKey: (nextKey: string) => void;
  /** The form's real public URL, for the prefill example. */
  publicUrl?: string | null;
  /** Switch the editor to the Connect tab (the mapping's other home). */
  onOpenConnect: () => void;
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

  // What the collapsed header says. Same vocabulary the left spine already uses,
  // so a badge means the same thing in both places.
  //
  // No "Conditional" badge here any more, and its absence is the point: the
  // show/hide conditions it announced now live in the always-visible Logic card
  // above, together with the personal-email gate. A collapsed group is only safe
  // while its badges describe what is INSIDE it — a badge for content that moved
  // out would send an author digging through the accordion for an editor that is
  // no longer there.
  const advancedBadges = [
    Object.keys(step.questionVariants ?? {}).length > 0 ? bm.settings.badgeDynamic : null,
    step.terminal ? bm.settings.badgeEndsForm : null,
    step.hidden ? bm.settings.badgeHidden : null,
    step.defaultValue ? bm.settings.badgeDefault : null,
    step.scoringEnabled && (step.sliderScoring?.length ?? 0) > 0 ? bm.settings.badgeScored : null,
  ].filter((b): b is string => !!b);

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
          <p className="text-2xs font-semibold uppercase tracking-wide text-faint">
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
          <p className="text-2xs font-semibold uppercase tracking-wide text-faint">
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
          <p className="text-2xs font-semibold uppercase tracking-wide text-faint">{em.types.slider}</p>
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
          <p className="text-2xs font-semibold uppercase tracking-wide text-faint">
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

      {/* Logic — this question's whole routing story, stated in plain language
          and ALWAYS visible, for every step type. */}
      <LogicCard
        step={step}
        index={index}
        steps={steps}
        scoringEnabled={scoringEnabled}
        onUpdate={onUpdate}
        bm={bm}
        em={em}
      />

      {/* Everything below is ADVANCED: dynamic copy, behaviour flags, the answer
          key, and scoring. Collapsed by default, but the header names whatever
          is configured inside — hiding that a question is terminal or hidden
          would be worse than the flat list this replaces.
          Conditional visibility is deliberately NOT in here any more: it moved
          into the always-visible Logic card above (F3a), because the one control
          that routes a lead to a booking screen cannot be the one behind a
          chevron. The badges follow it out — see `advancedBadges`. */}
      <AdvancedSettings badges={advancedBadges} m={bm.settings}>
        {/* What parameter prefills this answer. The runtime already supports it;
            nothing ever said so, which is why it went unused. */}
        {!isInputlessType(step.type) ? (
          <PrefillRow step={step} publicUrl={publicUrl ?? null} m={bm.settings} />
        ) : null}

        {/* Sits next to the prefill row on purpose: both fill an answer before
            anyone types, and seeing them together is what makes the precedence
            (default loses to the URL) legible. A scheduler's answer is a booking
            and a name step writes two subfields, so neither takes one. */}
        {!isInputlessType(step.type) && step.type !== 'scheduler' && step.type !== 'name' ? (
          <Field label={bm.settings.defaultAnswer} hint={bm.settings.defaultAnswerHint}>
            <TextField
              value={step.defaultValue ?? ''}
              maxLength={512}
              placeholder={bm.settings.defaultAnswerPlaceholder}
              data-testid="default-answer"
              aria-label={bm.settings.defaultAnswer}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => onUpdate({ defaultValue: e.target.value.trim() || undefined })}
            />
          </Field>
        ) : null}

      {/* Dynamic question — vary the text by an earlier answer. Variants swap the
          step's `question`, which a reveal never renders: it shows its own
          headline and subtitle, and BOTH already interpolate `[key]` tokens. So
          the section is dropped there rather than editing a field the respondent
          will never see. */}
      {step.type === 'reveal' ? null : (
        <section className="flex flex-col gap-3 border-t border-border pt-4">
          <p className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-faint">
            <i aria-hidden className="pi pi-sync text-secondary" style={{ fontSize: 11 }} />
            {em.variants.title}
          </p>
          <QuestionVariants step={step} index={index} steps={steps} onUpdate={onUpdate} m={em.variants} />
        </section>
      )}

      {/* Behavior — terminal (disqualify) + reveal position (V4-04/V4-12) */}
      <section className="flex flex-col gap-1 border-t border-border pt-4">
        <p className="mb-1 text-2xs font-semibold uppercase tracking-wide text-faint">
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

      </AdvancedSettings>

      {/* HubSpot — map this answer to a contact property. Message/reveal steps
          collect no answer, so there is nothing to map (a scheduler DOES answer
          — the booked slot — so it keeps the section). Restored here after
          d0ecffe dropped the render while collapsing the advanced settings; it
          stays OUTSIDE AdvancedSettings so the mapping is visible at a glance. */}
      {!isInputlessType(step.type) ? (
        <QuestionHubspotSection
          formId={formId}
          stepKey={step.key}
          steps={steps}
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
 * The Logic card — what this question's rules SAY, always on screen (F3a).
 *
 * The `showWhen`/`hideWhen` conditions are the only mechanism for score-gated
 * branching — the thing that routes a lead to one of three booking screens — and
 * they used to live inside the collapsed Advanced group, while the forward
 * `goto` rules sat in their own always-visible section above. One question's
 * logic was split across a visible surface and a hidden one, and the closed
 * accordion said no more than "Conditional": a rule exists, nothing about what
 * it says.
 *
 * So this card STATES the rules instead of hiding an editor behind a chevron. It
 * reuses `describeCondition` — the same describer the Logic map reads from, so
 * the panel and the map can never word the same rule differently — and hands
 * every edit to the shared {@link LogicDialog}, which is now the single editor
 * for visibility, routing and the after-booking jump. Nothing here writes config
 * except the personal-email switch (see below).
 *
 * It renders for EVERY step type, not just the routable ones: a free-text or
 * message step has no `goto` surface but can still be gated by a condition, and
 * the old section's `hasOptions` guard meant those steps showed no logic at all.
 */
function LogicCard({
  step,
  index,
  steps,
  scoringEnabled,
  onUpdate,
  bm,
  em,
}: {
  step: FormStep;
  index: number;
  steps: FormStep[];
  scoringEnabled: boolean;
  onUpdate: (patch: Partial<FormStep>) => void;
  bm: BuilderMessages;
  em: EditorMessages;
}) {
  const [open, setOpen] = useState(false);
  // The settings panel is not keyed by step, so selecting another question keeps
  // this component mounted — an open dialog would silently re-target the new
  // step, editing rules the author never opened.
  useEffect(() => setOpen(false), [step.key]);

  // A catch-all that can never fire (a stale `*` on a message or a reveal) is
  // not logic: it is not counted, not bordered and not spelled out below.
  const count = liveRuleCount(step);
  const titleOf = (s: FormStep, i: number): string => s.question?.trim() || tb(bm.canvas.questionN, { n: i + 1 });
  const targetLabel = (target: string): string => {
    const ti = steps.findIndex((s) => s.key === target);
    const t = ti >= 0 ? steps[ti] : undefined;
    return t ? titleOf(t, ti) : target;
  };

  // A catch-all `goto` on `*` is writable on EVERY step type, not just a
  // scheduler — the Branching dialog's "Always go to" writes exactly this rule.
  // So it is detected everywhere; only the WORDING is per type. A scheduler
  // gets the After-booking line (its answer is a booking, and that line names
  // the target on its own); every other type reads as a sentence below, where
  // `*` must never print raw — "If * → Q4" is the config, not an answer anyone
  // could give.
  // …and only rules that can RUN are drawn. A step that records no answer (a
  // message, a reveal) can never match a `goto` of any shape, so a rule saved
  // on one is dead config — it stays in the config, but it is not a sentence
  // this card is willing to print.
  const { valueRules, catchAll } = splitGoto(step);
  const live = liveGotoRules(step).length > 0;
  const scheduler = step.type === 'scheduler';
  const bookingLabel =
    !scheduler || !catchAll
      ? null
      : catchAll.target == null
        ? bm.settings.schedulerAfterSubmit
        : targetLabel(catchAll.target);
  // Last, the order the engine walks: the catch-all matches any answer, so
  // every value rule above it is tried first.
  const routed = !live ? [] : catchAll && !bookingLabel ? [...valueRules, catchAll] : valueRules;

  // The personal-email gate is a visibility rule too — it just is not one of the
  // declarative conditions the dialog edits, so it keeps its own switch and
  // stays HERE rather than back in the accordion: leaving one third of "when
  // does this question appear" behind a chevron would rebuild the exact split
  // this card removes. It needs an earlier email answer, which is impossible on
  // the first question; a reveal is played or skipped by the plain conditions
  // instead, so a second, narrower rule there looked meaningful and wasn't.
  const personalEmail = step.type !== 'email' && step.type !== 'reveal' && index > 0;
  const gated = personalEmail && !!step.showForPersonalEmailOnly;
  const lines = (step.showWhen ? 1 : 0) + (step.hideWhen ? 1 : 0) + (bookingLabel ? 1 : 0) + routed.length;

  return (
    // `shrink-0` and NO `overflow` — see the paragraph in `advanced-settings.tsx`:
    // any overflow other than `visible` resolves `min-height: auto` to 0 on a
    // flex child of this scrolling column, and the box collapses to a couple of
    // pixels with its content laid out, clipped, inside it.
    <section data-testid="question-logic" className="flex shrink-0 flex-col gap-3 border-t border-border pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-faint">
          <i aria-hidden className="pi pi-sitemap text-secondary" style={{ fontSize: 11 }} />
          {bm.settings.logic}
          {count > 0 ? (
            // The same count the left spine puts on the question, so the two
            // surfaces agree on how many rules there are.
            <span
              data-testid="question-logic-count"
              className="rounded-sm bg-secondary/15 px-1.5 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-secondary"
            >
              {count === 1 ? bm.badges.ruleOne : tb(bm.badges.rules, { n: count })}
            </span>
          ) : null}
        </p>
        <Button
          variant="outline"
          size="sm"
          data-testid="question-logic-edit"
          onClick={() => setOpen(true)}
        >
          <i aria-hidden className="pi pi-pencil" style={{ fontSize: 11 }} /> {bm.logicDialog.open}
        </Button>
      </div>

      {lines > 0 ? (
        <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-background p-2.5">
          {step.showWhen ? <ConditionSentence kind="show" cond={step.showWhen} steps={steps} bm={bm} /> : null}
          {step.hideWhen ? <ConditionSentence kind="hide" cond={step.hideWhen} steps={steps} bm={bm} /> : null}
          {bookingLabel ? (
            <p
              data-testid="question-logic-booking"
              className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-[11px] leading-relaxed"
            >
              <span className="shrink-0 rounded bg-secondary/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-secondary">
                {bm.settings.schedulerAfter}
              </span>
              <span className="font-medium text-foreground">{bookingLabel}</span>
            </p>
          ) : null}
          {routed.map((rule, i) => {
            // Same expression the Logic map reads from, so the panel and the map
            // can never word one rule two ways. `optionLabel` falls back to the
            // raw value, which on a catch-all is the literal `*`.
            const value = rule.values.includes('*')
              ? scheduler
                ? bm.branching.anyBooking
                : bm.branching.anyAnswer
              : rule.values.map((v) => optionLabel(step, v)).join(', ');
            return (
              <p
                key={i}
                data-testid="question-logic-goto"
                className="flex items-start gap-1.5 text-[11px] leading-relaxed text-foreground"
              >
                <i aria-hidden className="pi pi-directions mt-0.5 shrink-0 text-secondary" style={{ fontSize: 10 }} />
                <span className="min-w-0 break-words">
                  {rule.target == null
                    ? tb(bm.map.skipEdge, { value })
                    : tb(bm.map.jumpEdge, { value, target: targetLabel(rule.target) })}
                </span>
              </p>
            );
          })}
        </div>
      ) : gated ? null : (
        // No rules at all. Say that in a sentence — an empty editor (which is
        // what the old panel showed) reads as broken rather than as "this
        // question always appears". Suppressed when the personal-email switch
        // below is ON, since then the question does NOT always appear.
        <p data-testid="question-logic-empty" className="text-xs leading-relaxed text-muted-foreground">
          {bm.logicDialog.empty}
        </p>
      )}

      {personalEmail ? (
        <InlineField label={em.logic.personalEmailOnly} hint={em.logic.personalEmailHint}>
          <Switch
            checked={!!step.showForPersonalEmailOnly}
            onCheckedChange={(v) => onUpdate({ showForPersonalEmailOnly: v || undefined })}
            aria-label={em.logic.personalEmailOnly}
          />
        </InlineField>
      ) : null}

      <LogicDialog
        open={open}
        onClose={() => setOpen(false)}
        step={step}
        index={index}
        steps={steps}
        scoringEnabled={scoringEnabled}
        onUpdate={onUpdate}
        bm={bm}
        em={em}
      />
    </section>
  );
}

/**
 * One show/hide rule as a readable sentence — "SHOW IF «Budget» is greater than
 * 500" — in the same grammar and the same colours the Logic map uses, because it
 * is the same describer: `describeCondition` resolves the stored field KEY to
 * its question title and raw values to their option LABELS, which is the whole
 * difference between a sentence an author recognizes and the config as stored.
 * A rule pointing at a deleted question is called out: it can never hold, so it
 * hides the question forever.
 */
function ConditionSentence({
  kind,
  cond,
  steps,
  bm,
}: {
  kind: 'show' | 'hide';
  cond: NonNullable<FormStep['showWhen']>;
  steps: FormStep[];
  bm: BuilderMessages;
}) {
  const d = describeCondition(cond, steps, {
    fallbackQuestion: (i) => tb(bm.canvas.questionN, { n: i + 1 }),
    opIn: bm.map.condIn,
    opEq: bm.map.condEq,
    opGt: bm.map.condGt,
    opLt: bm.map.condLt,
    opBetween: bm.map.condBetween,
    and: bm.map.condAnd,
    blank: bm.map.condBlank,
    score: bm.map.condScore,
  });
  const show = kind === 'show';
  return (
    <p
      data-testid={`question-logic-${kind}`}
      className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-[11px] leading-relaxed"
    >
      <span
        className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
          show ? 'bg-secondary/15 text-secondary' : 'bg-destructive/15 text-destructive'
        }`}
      >
        {show ? bm.map.condShowIf : bm.map.condHideIf}
      </span>
      <span className="font-semibold text-foreground">{d.field}</span>
      <span className="text-muted-foreground">{d.operator}</span>
      <span className="font-medium text-foreground">{d.operand}</span>
      {d.dangling ? (
        <span
          data-testid="question-logic-dangling"
          className="rounded bg-destructive/15 px-1.5 py-0.5 text-[10px] font-semibold text-destructive"
        >
          {bm.map.condMissingField}
        </span>
      ) : null}
    </p>
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
      <span className="text-xs font-medium text-muted-foreground">{m.fieldKey}</span>
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
        <p role="alert" data-testid="step-field-key-taken" className="text-xs text-destructive">
          {collides || refused === 'taken' ? m.fieldKeyTaken : m.fieldKeyInvalid}
        </p>
      ) : (
        <p className="text-2xs leading-relaxed text-faint">
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
          <span className="text-xs font-medium text-muted-foreground">
            {i === 0 ? m.first : m.second}
          </span>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">{m.fieldKey}</span>
            <TextField
              value={field}
              onChange={(e) => setFieldKey(i, e.target.value)}
              className="h-8 py-1 font-mono text-xs"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">{m.placeholder}</span>
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
      <p className="text-2xs leading-relaxed text-faint" data-testid="name-fieldkey-hint">
        {m.fieldKeyHint}
      </p>
    </div>
  );
}
