'use client';

import type { FormStep } from '@quill/engine';
import { defaultFlowGroup } from '@quill/engine';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Field, NumberField, SelectField, InlineField } from './fields';
import { OptionsEditor } from './options-editor';
import { SliderScoringEditor } from './slider-scoring-editor';
import { LogicRules } from './logic-rules';
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
}) {
  const contact = isContactType(step.type);

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
            if (confirm(bm.settings.deleteConfirm)) onDelete();
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
        <section className="border-t border-border pt-4">
          <Field label={em.props.phoneMinDigits}>
            <NumberField
              value={step.phoneMinDigits ?? 7}
              min={1}
              onChange={(e) => onUpdate({ phoneMinDigits: Number(e.target.value) || undefined })}
            />
          </Field>
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
            {step.type === 'slider' && scoringEnabled ? (
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
    </div>
  );
}
