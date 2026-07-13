'use client';

import type { FormStep, FormFieldType } from '@quill/engine';
import { defaultFlowGroup } from '@quill/engine';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import {
  Field,
  TextField,
  TextArea,
  NumberField,
  SelectField,
  InlineField,
  PanelSection,
} from './fields';
import { OptionsEditor } from './options-editor';
import { SliderScoringEditor } from './slider-scoring-editor';
import { ConditionEditor, type PriorField } from './condition-editor';
import { QuestionVariantsEditor } from './question-variants-editor';
import type { EditorMessages } from './messages';

const STEP_TYPES: FormFieldType[] = [
  'text',
  'name',
  'email',
  'phone',
  'dropdown',
  'multiple_choice',
  'slider',
  'textarea',
  'message',
];

const hasOptions = (t: FormFieldType) => t === 'dropdown' || t === 'multiple_choice';

/**
 * The center panel: every property of the selected step, for all 9 kinds.
 * Common anatomy up top (type, question, helper, required, button, flow group),
 * then kind-specific blocks (options, slider bounds+scoring, email/phone
 * validation), then cross-cutting logic (dynamic question + conditional
 * visibility). One vertical rhythm; the page scrolls (no inner scrollbar).
 */
export function StepProperties({
  step,
  index,
  priorFields,
  onUpdate,
  onDelete,
  m,
}: {
  step: FormStep;
  index: number;
  priorFields: PriorField[];
  onUpdate: (patch: Partial<FormStep>) => void;
  onDelete: () => void;
  m: EditorMessages;
}) {
  const showButton = step.type === 'message';

  return (
    <div className="flex flex-col gap-4">
      <PanelSection
        title={m.steps.stepN.replace('{n}', String(index + 1))}
        action={
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (confirm(m.steps.deleteConfirm)) onDelete();
            }}
            className="text-muted-foreground hover:text-destructive"
          >
            <i aria-hidden className="pi pi-trash" style={{ fontSize: 12 }} /> {m.steps.delete}
          </Button>
        }
      >
        <Field label={m.props.type}>
          <SelectField
            value={step.type}
            onChange={(e) => {
              const type = e.target.value as FormFieldType;
              const patch: Partial<FormStep> = { type, flowGroup: defaultFlowGroup(type) };
              if (hasOptions(type) && (step.options ?? []).length === 0) {
                patch.options = [{ label: 'Option 1', value: 'option_1', points: 0 }];
              }
              if (type === 'slider' && step.min == null) {
                patch.min = 0;
                patch.max = 100;
                patch.step = 1;
                patch.default = 50;
              }
              onUpdate(patch);
            }}
          >
            {STEP_TYPES.map((t) => (
              <option key={t} value={t}>
                {m.types[t]}
              </option>
            ))}
          </SelectField>
        </Field>

        <Field label={m.props.question}>
          <TextArea
            value={step.question ?? ''}
            rows={2}
            placeholder={m.props.questionPlaceholder}
            onChange={(e) => onUpdate({ question: e.target.value })}
          />
        </Field>

        <Field label={m.props.helper}>
          <TextField
            value={step.helper ?? ''}
            onChange={(e) => onUpdate({ helper: e.target.value || null })}
          />
        </Field>

        {step.type !== 'message' && step.type !== 'slider' && !hasOptions(step.type) ? (
          <Field label={m.props.placeholder}>
            <TextField
              value={step.placeholder ?? ''}
              onChange={(e) => onUpdate({ placeholder: e.target.value || null })}
            />
          </Field>
        ) : null}

        {showButton ? (
          <Field label={m.props.buttonText}>
            <TextField
              value={step.buttonText ?? ''}
              placeholder={m.props.buttonTextPlaceholder}
              onChange={(e) => onUpdate({ buttonText: e.target.value || null })}
            />
          </Field>
        ) : null}

        {step.type !== 'message' ? (
          <InlineField label={m.props.required}>
            <Switch
              checked={step.required !== false}
              onCheckedChange={(v) => onUpdate({ required: v })}
              aria-label={m.props.required}
            />
          </InlineField>
        ) : null}

        <Field label={m.props.flowGroup} hint={m.props.flowGroupHint}>
          <SelectField
            value={step.flowGroup ?? defaultFlowGroup(step.type)}
            onChange={(e) => onUpdate({ flowGroup: e.target.value as FormStep['flowGroup'] })}
          >
            <option value="qualification">{m.props.qualification}</option>
            <option value="lead_capture">{m.props.leadCapture}</option>
          </SelectField>
        </Field>
      </PanelSection>

      {hasOptions(step.type) ? (
        <PanelSection title={m.options.title}>
          <OptionsEditor
            options={step.options ?? []}
            onChange={(options) => onUpdate({ options })}
            m={m.options}
          />
        </PanelSection>
      ) : null}

      {step.type === 'slider' ? (
        <PanelSection title={m.types.slider}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label={m.props.sliderMin}>
              <NumberField value={step.min ?? 0} onChange={(e) => onUpdate({ min: Number(e.target.value) || 0 })} />
            </Field>
            <Field label={m.props.sliderMax}>
              <NumberField value={step.max ?? 100} onChange={(e) => onUpdate({ max: Number(e.target.value) || 0 })} />
            </Field>
            <Field label={m.props.sliderStep}>
              <NumberField value={step.step ?? 1} onChange={(e) => onUpdate({ step: Number(e.target.value) || 1 })} />
            </Field>
            <Field label={m.props.sliderDefault}>
              <NumberField
                value={step.default ?? 0}
                onChange={(e) => onUpdate({ default: Number(e.target.value) || 0 })}
              />
            </Field>
          </div>
          <div className="mt-1">
            <p className="mb-2 text-xs font-medium text-muted-foreground">{m.sliderScoring.hint}</p>
            <SliderScoringEditor
              ranges={step.sliderScoring ?? []}
              onChange={(sliderScoring) => onUpdate({ sliderScoring })}
              m={m.sliderScoring}
            />
          </div>
        </PanelSection>
      ) : null}

      {step.type === 'email' ? (
        <PanelSection title={m.types.email}>
          <InlineField label={m.props.corporateEmailOnly} hint={m.props.corporateEmailHint}>
            <Switch
              checked={!!step.corporateEmailOnly}
              onCheckedChange={(v) => onUpdate({ corporateEmailOnly: v || undefined })}
              aria-label={m.props.corporateEmailOnly}
            />
          </InlineField>
        </PanelSection>
      ) : null}

      {step.type === 'phone' ? (
        <PanelSection title={m.types.phone}>
          <Field label={m.props.phoneMinDigits}>
            <NumberField
              value={step.phoneMinDigits ?? 7}
              min={1}
              onChange={(e) => onUpdate({ phoneMinDigits: Number(e.target.value) || undefined })}
            />
          </Field>
        </PanelSection>
      ) : null}

      <PanelSection title={m.variants.title}>
        <QuestionVariantsEditor step={step} priorFields={priorFields} onUpdate={onUpdate} m={m.variants} />
      </PanelSection>

      <PanelSection title={m.logic.title}>
        {priorFields.length === 0 ? (
          <p className="text-xs text-muted-foreground">{m.logic.noPriorFields}</p>
        ) : (
          <div className="flex flex-col gap-4">
            <ConditionEditor
              label={m.logic.showWhen}
              condition={step.showWhen}
              priorFields={priorFields}
              onChange={(showWhen) => onUpdate({ showWhen })}
              m={m.logic}
            />
            <ConditionEditor
              label={m.logic.hideWhen}
              condition={step.hideWhen}
              priorFields={priorFields}
              onChange={(hideWhen) => onUpdate({ hideWhen })}
              m={m.logic}
            />
          </div>
        )}
      </PanelSection>
    </div>
  );
}
