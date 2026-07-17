'use client';

import type { FormStep } from '@quill/engine';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Field, SelectField, TextField, InlineField } from './fields';
import { hasOptions } from './question-types';
import type { EditorMessages } from './messages';
import { TokenTextarea, tokenOptionsBefore, allTokenKeys } from './token-textarea';

const FALLBACK = '*';

/** fields.tsx `controlBase` + the panel's compact sizing, for TokenTextarea. */
const VARIANT_TEXTAREA_CLASS =
  'rounded-md border border-input bg-background px-3 py-1.5 text-xs transition-colors ' +
  'placeholder:text-muted-foreground hover:border-muted-foreground ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y';

/**
 * Dynamic question editor: vary this question's text by the answer to an
 * EARLIER field (`questionField` + `questionVariants`, `*` = fallback), with
 * `[field]` interpolation supported in every variant. Slider steps also get a
 * per-variant unit label (`sliderLabelVariants`). Resolution is the engine's
 * `resolveQuestion`, so the builder and the public renderer always agree.
 */
export function QuestionVariants({
  step,
  index,
  steps,
  onUpdate,
  m,
}: {
  step: FormStep;
  index: number;
  steps: FormStep[];
  onUpdate: (patch: Partial<FormStep>) => void;
  m: EditorMessages['variants'];
}) {
  const prior = steps.slice(0, index);
  const enabled = !!step.questionField;
  const source = prior.find((s) => s.key === step.questionField);
  const sourceOptions = source && hasOptions(source.type) ? (source.options ?? []) : null;
  const variants = step.questionVariants ?? {};
  const rows = Object.keys(variants).filter((k) => k !== FALLBACK);
  const isSlider = step.type === 'slider';

  // The @ picker in every variant textarea: insertable tokens are the fields
  // captured BEFORE this step (all the engine's `interpolate` resolves here);
  // allKeys classifies a referenced later-step vs. unknown token for warnings.
  const tokens = tokenOptionsBefore(steps, index);
  const allKeys = allTokenKeys(steps);
  const tokenMessages = {
    pickerLabel: m.tokenPickerLabel,
    pickerEmpty: m.tokenPickerEmpty,
    pickerNoMatch: m.tokenPickerNoMatch,
    warnLater: m.tokenWarnLater,
    warnUnknown: m.tokenWarnUnknown,
  };

  function toggle(on: boolean) {
    if (!on) {
      // Non-destructive: clear only the pointer; the variant rows are kept
      // (inert) so an accidental toggle loses nothing.
      onUpdate({ questionField: undefined });
      return;
    }
    const first = prior.find((s) => hasOptions(s.type)) ?? prior[0];
    if (!first) return;
    onUpdate({ questionField: first.key, questionVariants: step.questionVariants ?? {} });
  }

  function setVariant(key: string, text: string) {
    onUpdate({ questionVariants: { ...variants, [key]: text } });
  }

  function renameVariant(oldKey: string, newKey: string) {
    if (newKey === oldKey) return;
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries(variants)) next[k === oldKey ? newKey : k] = v;
    const patch: Partial<FormStep> = { questionVariants: next };
    if (step.sliderLabelVariants && step.sliderLabelVariants[oldKey] != null) {
      const labels: Record<string, string> = {};
      for (const [k, v] of Object.entries(step.sliderLabelVariants)) labels[k === oldKey ? newKey : k] = v;
      patch.sliderLabelVariants = labels;
    }
    onUpdate(patch);
  }

  function removeVariant(key: string) {
    const next = { ...variants };
    delete next[key];
    const patch: Partial<FormStep> = {
      questionVariants: Object.keys(next).length ? next : undefined,
    };
    if (step.sliderLabelVariants && step.sliderLabelVariants[key] != null) {
      const labels = { ...step.sliderLabelVariants };
      delete labels[key];
      patch.sliderLabelVariants = Object.keys(labels).length ? labels : undefined;
    }
    onUpdate(patch);
  }

  function setSliderLabel(key: string, text: string) {
    const labels = { ...(step.sliderLabelVariants ?? {}) };
    if (text) labels[key] = text;
    else delete labels[key];
    onUpdate({ sliderLabelVariants: Object.keys(labels).length ? labels : undefined });
  }

  function addVariant() {
    const taken = new Set(rows);
    const free = sourceOptions?.find((o) => !taken.has(o.value))?.value;
    const key = free ?? `value_${rows.length + 1}`;
    if (variants[key] != null) return;
    setVariant(key, '');
  }

  return (
    <div className="flex flex-col gap-3">
      <InlineField label={m.enable} hint={m.hint}>
        <Switch checked={enabled} onCheckedChange={toggle} aria-label={m.enable} disabled={prior.length === 0} />
      </InlineField>

      {enabled ? (
        <>
          <Field label={m.field}>
            <SelectField
              value={step.questionField ?? ''}
              onChange={(e) => onUpdate({ questionField: e.target.value || undefined })}
              className="h-8 py-1 text-xs"
            >
              {prior.map((s, i) => (
                <option key={s.key} value={s.key}>
                  {s.question?.trim() || `${i + 1} · ${s.key}`}
                </option>
              ))}
            </SelectField>
          </Field>

          {/* Keyed by position (renames preserve entry order), so typing a new
              match value never remounts the row and steals focus. */}
          {rows.map((key, i) => (
            <div key={i} className="flex flex-col gap-2 rounded-lg border border-border bg-background p-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium text-muted-foreground">{m.matchValue}</span>
                <button
                  type="button"
                  aria-label={m.remove}
                  onClick={() => removeVariant(key)}
                  className="text-muted-foreground transition-colors hover:text-destructive focus-visible:outline-none"
                >
                  <i aria-hidden className="pi pi-times" style={{ fontSize: 11 }} />
                </button>
              </div>
              {sourceOptions ? (
                <SelectField
                  aria-label={m.matchValue}
                  value={key}
                  onChange={(e) => renameVariant(key, e.target.value)}
                  className="h-8 py-1 text-xs"
                >
                  {/* Keep the current key listed even when it no longer matches an option. */}
                  {!sourceOptions.some((o) => o.value === key) ? <option value={key}>{key}</option> : null}
                  {sourceOptions.map((o) => (
                    <option key={o.value} value={o.value} disabled={o.value !== key && variants[o.value] != null}>
                      {o.label || o.value}
                    </option>
                  ))}
                </SelectField>
              ) : (
                <TextField
                  aria-label={m.matchValue}
                  value={key}
                  placeholder={m.matchValuePlaceholder}
                  onChange={(e) => renameVariant(key, e.target.value)}
                  className="h-8 py-1 text-xs"
                />
              )}
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-muted-foreground">{m.variantQuestion}</span>
                <TokenTextarea
                  value={variants[key] ?? ''}
                  rows={2}
                  onChange={(v) => setVariant(key, v)}
                  placeholder=""
                  ariaLabel={m.variantQuestion}
                  tokens={tokens}
                  allKeys={allKeys}
                  m={tokenMessages}
                  className={VARIANT_TEXTAREA_CLASS}
                />
              </div>
              {isSlider ? (
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium text-muted-foreground">{m.sliderLabel}</span>
                  <TextField
                    value={step.sliderLabelVariants?.[key] ?? ''}
                    onChange={(e) => setSliderLabel(key, e.target.value)}
                    className="h-8 py-1 text-xs"
                  />
                </label>
              ) : null}
            </div>
          ))}

          <Field label={m.fallback}>
            <TokenTextarea
              value={variants[FALLBACK] ?? ''}
              rows={2}
              onChange={(text) => {
                if (text) setVariant(FALLBACK, text);
                else removeVariant(FALLBACK);
              }}
              placeholder=""
              ariaLabel={m.fallback}
              tokens={tokens}
              allKeys={allKeys}
              m={tokenMessages}
              className={VARIANT_TEXTAREA_CLASS}
            />
          </Field>

          <Button variant="outline" size="sm" onClick={addVariant} className="self-start">
            <i aria-hidden className="pi pi-plus" style={{ fontSize: 11 }} /> {m.add}
          </Button>

          <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
            <i aria-hidden className="pi pi-info-circle mt-0.5" style={{ fontSize: 10 }} />
            {m.interpolationHint}
          </p>
        </>
      ) : null}
    </div>
  );
}
