'use client';

import { useMemo } from 'react';
import type { FormStep } from '@quill/engine';
import { defaultFlowGroup } from '@quill/engine';
import { COUNTRIES, countryName, getMessages } from '@quill/shared';
import { clientLocale } from '@/lib/client-locale';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Select, type SelectOption } from '@/components/ui/select';
import { useConfirmDialog } from '@/components/ui/confirm-dialog';
import { Field, NumberField, SelectField, InlineField, TextField } from './fields';
import { OptionsEditor } from './options-editor';
import { SliderScoringEditor } from './slider-scoring-editor';
import { maxScoreForSteps } from './scoring-util';
import { LogicRules } from './logic-rules';
import { LogicConditions } from './logic-conditions';
import { QuestionVariants } from './question-variants';
import { QuestionHubspotSection } from './question-hubspot';
import { GALLERY, GALLERY_GROUPS, hasOptions, isContactType, type GalleryItem } from './question-types';
import type { EditorMessages } from './messages';
import type { BuilderMessages } from './builder-messages';

const ALL_ITEMS: GalleryItem[] = GALLERY_GROUPS.flatMap((g) => GALLERY[g]);

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
  scoringEnabled,
  onUpdate,
  onDelete,
  onScoringChange,
  bm,
  em,
  formId,
  locale,
  onOpenConnect,
  onOpenDesign,
  revealAfterStep,
  onRevealAfterStepChange,
}: {
  step: FormStep;
  index: number;
  steps: FormStep[];
  scoringEnabled: boolean;
  onUpdate: (patch: Partial<FormStep>) => void;
  onDelete: () => void;
  onScoringChange: (enabled: boolean) => void;
  bm: BuilderMessages;
  em: EditorMessages;
  formId: string;
  locale: string;
  /** Switch the editor to the Connect tab (HubSpot destination setup). */
  onOpenConnect: () => void;
  /** Switch the editor to the Design tab (reveal-screen copy/duration — V4-12). */
  onOpenDesign: () => void;
  /** Current 1-based `config.revealAfterStep` (the reveal marker's position). */
  revealAfterStep?: number;
  /** Pin the reveal after THIS step (1-based) or clear it (`undefined`) — V4-04. */
  onRevealAfterStepChange: (afterStep: number | undefined) => void;
}) {
  const contact = isContactType(step.type);
  // Form-wide "highest possible" total (same math as Results). Drives the
  // "assign points" nudge when scoring is on but nothing scores yet.
  const scoringMax = maxScoreForSteps(steps);
  const { confirm: confirmDialog, dialog } = useConfirmDialog();

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

      {step.type !== 'message' ? (
        <InlineField label={bm.settings.required}>
          <Switch
            checked={step.required !== false}
            onCheckedChange={(v) => onUpdate({ required: v })}
            aria-label={bm.settings.required}
          />
        </InlineField>
      ) : null}

      {/* Type-specific: options + points */}
      {hasOptions(step.type) ? (
        <section className="flex flex-col gap-3 border-t border-border pt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {bm.settings.options}
          </p>
          <OptionsEditor options={step.options ?? []} onChange={(options) => onUpdate({ options })} m={em.options} />
        </section>
      ) : null}

      {step.type === 'slider' ? (
        <section className="flex flex-col gap-3 border-t border-border pt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{em.types.slider}</p>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label={em.props.sliderMin}>
              <NumberField value={step.min ?? 0} onChange={(e) => onUpdate({ min: Number(e.target.value) || 0 })} />
            </Field>
            <Field label={em.props.sliderMax}>
              <NumberField value={step.max ?? 100} onChange={(e) => onUpdate({ max: Number(e.target.value) || 0 })} />
            </Field>
            <Field label={em.props.sliderStep}>
              <NumberField value={step.step ?? 1} onChange={(e) => onUpdate({ step: Number(e.target.value) || 1 })} />
            </Field>
            <Field label={em.props.sliderDefault}>
              <NumberField value={step.default ?? 0} onChange={(e) => onUpdate({ default: Number(e.target.value) || 0 })} />
            </Field>
          </div>
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
          <Field label={em.props.phoneMinDigits}>
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
            the first question, so hide it there. */}
        {step.type !== 'email' && index > 0 ? (
          <InlineField label={em.logic.personalEmailOnly} hint={em.logic.personalEmailHint}>
            <Switch
              checked={!!step.showForPersonalEmailOnly}
              onCheckedChange={(v) => onUpdate({ showForPersonalEmailOnly: v || undefined })}
              aria-label={em.logic.personalEmailOnly}
            />
          </InlineField>
        ) : null}
      </section>

      {/* Dynamic question — vary the text by an earlier answer */}
      <section className="flex flex-col gap-3 border-t border-border pt-4">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <i aria-hidden className="pi pi-sync text-secondary" style={{ fontSize: 11 }} />
          {em.variants.title}
        </p>
        <QuestionVariants step={step} index={index} steps={steps} onUpdate={onUpdate} m={em.variants} />
      </section>

      {/* Behavior — terminal (disqualify) + reveal position (V4-04/V4-12) */}
      <section className="flex flex-col gap-1 border-t border-border pt-4">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {em.behavior.title}
        </p>
        <InlineField label={em.behavior.terminal} hint={em.behavior.terminalHint}>
          <Switch
            checked={!!step.terminal}
            onCheckedChange={(v) => onUpdate({ terminal: v || undefined })}
            aria-label={em.behavior.terminal}
          />
        </InlineField>
        {/* Hidden question — never shown; its answer is seeded from a matching
            URL parameter and carried into the submission. Meaningless for a
            message step (it collects no answer), so hide it there. */}
        {step.type !== 'message' ? (
          <InlineField label={em.behavior.hidden} hint={em.behavior.hiddenHint}>
            <Switch
              checked={!!step.hidden}
              onCheckedChange={(v) => onUpdate({ hidden: v || undefined })}
              aria-label={em.behavior.hidden}
            />
          </InlineField>
        ) : null}
        {/* The reveal POSITION lives in config.revealAfterStep (the draggable
            spine marker is the primary control); this toggle is a convenience to
            pin the reveal after THIS question. Clearing reverts to the default
            (after the last question). */}
        <InlineField label={em.behavior.reveal} hint={em.behavior.revealHint}>
          <Switch
            checked={revealAfterStep === index + 1}
            onCheckedChange={(v) => onRevealAfterStepChange(v ? index + 1 : undefined)}
            aria-label={em.behavior.reveal}
          />
        </InlineField>
        <button
          type="button"
          data-testid="behavior-edit-reveal"
          onClick={onOpenDesign}
          className="mt-1 inline-flex w-fit items-center gap-1.5 rounded-md text-xs font-medium text-secondary transition-colors hover:text-secondary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <i aria-hidden className="pi pi-pencil" style={{ fontSize: 11 }} />
          {em.behavior.editReveal}
        </button>
      </section>

      {/* Scoring / contact hint */}
      <section className="border-t border-border pt-4">
        {contact ? (
          <p className="text-xs text-muted-foreground">{bm.settings.contactHint}</p>
        ) : (
          <>
            <InlineField label={bm.settings.scoring}>
              <Switch
                checked={scoringEnabled}
                onCheckedChange={onScoringChange}
                aria-label={bm.settings.scoring}
              />
            </InlineField>
            <p className="mt-1 text-xs text-muted-foreground">{bm.settings.scoringHint}</p>
            {scoringEnabled && scoringMax === 0 ? (
              <p
                data-testid="scoring-zero-hint"
                className="mt-1.5 flex items-start gap-1.5 text-xs text-muted-foreground"
              >
                <i aria-hidden className="pi pi-info-circle mt-0.5 text-secondary" style={{ fontSize: 11 }} />
                {bm.settings.scoringZeroHint}
              </p>
            ) : null}
            {/* Slider ranges show for every slider (parity with the always-on
                option Points column) so scoring isn't mysteriously hidden. */}
            {step.type === 'slider' ? (
              <div className="mt-3">
                <SliderScoringEditor
                  ranges={step.sliderScoring ?? []}
                  onChange={(sliderScoring) => onUpdate({ sliderScoring })}
                  m={em.sliderScoring}
                />
              </div>
            ) : null}
          </>
        )}
      </section>

      {/* HubSpot — map this answer to a contact property (message steps
          collect no answer, so there is nothing to map). */}
      {step.type !== 'message' ? (
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
