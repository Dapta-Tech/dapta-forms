'use client';

import type { FormOption, FormStep } from '@quill/engine';
import { isMultiSelect } from '@quill/engine';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { Field, SelectField, TextField, InlineField } from './fields';
import { hasOptions } from './question-types';
import type { EditorMessages } from './messages';
import { TokenTextarea, tokenOptionsBefore, allTokenKeys } from './token-textarea';

const FALLBACK = '*';

/** The values a multi-value variant key encodes, in the order they were ticked. */
function keyValues(key: string): string[] {
  return key
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

/**
 * The match picker for a MULTI-SELECT source (V5-A7): tick every option this
 * variant answers to, and the row's key becomes their comma-joined set.
 *
 * The engine compares a multi-select answer against this key as a SET, so tick
 * order does not matter and a row only fires when the respondent picked exactly
 * those options. Options already claimed by another row are disabled, since two
 * rows with the same key cannot both exist in the variants map.
 */
function MultiMatchPicker({
  options,
  value,
  taken,
  onChange,
  m,
}: {
  options: FormOption[];
  /** The current row key (comma-joined values). */
  value: string;
  /** Other rows' keys — used to block building a duplicate set. */
  taken: string[];
  onChange: (nextKey: string) => void;
  m: EditorMessages['variants'];
}) {
  const picked = keyValues(value);
  const takenSets = taken.map((k) => keyValues(k).slice().sort().join(','));

  function toggle(optionValue: string) {
    const next = picked.includes(optionValue)
      ? picked.filter((v) => v !== optionValue)
      : [...picked, optionValue];
    const nextKey = next.join(',');
    // An empty row would key on '' and match an unanswered field — refuse it,
    // and refuse a set another row already owns.
    if (!nextKey) return;
    if (takenSets.includes(next.slice().sort().join(','))) return;
    onChange(nextKey);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium text-muted-foreground">{m.matchValueMulti}</span>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={m.matchValueMulti}>
        {options.map((o) => {
          const on = picked.includes(o.value);
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={on}
              data-testid="variant-multi-option"
              onClick={() => toggle(o.value)}
              className={cn(
                'rounded-md border px-2 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                on
                  ? 'border-primary bg-primary/10 font-medium text-foreground'
                  : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              {o.label || o.value}
            </button>
          );
        })}
      </div>
      {picked.length === 0 ? (
        <span className="text-[11px] text-destructive">{m.matchValueMultiEmpty}</span>
      ) : null}
    </div>
  );
}

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
  // A checkbox source answers with an ARRAY, and the variant key is the joined
  // set — so a single-pick dropdown could never author a row that matches
  // someone who ticked two boxes (V5-A7). Multi-select sources get a checkbox
  // picker that builds the multi-value key instead.
  const sourceMultiSelect = source != null && isMultiSelect(source);
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
    warnRaw: m.tokenWarnRaw,
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
    // Seed ONE empty variant row on enable so the pattern is visible (V4-09),
    // but preserve any rows the author already authored (non-destructive
    // re-enable) — only seed when there are none yet (ignoring the `*` fallback).
    const existing = step.questionVariants ?? {};
    const hasRows = Object.keys(existing).some((k) => k !== FALLBACK);
    const firstOption = hasOptions(first.type) ? first.options?.[0]?.value : undefined;
    const nextVariants = hasRows ? existing : { ...existing, [firstOption ?? 'value_1']: '' };
    onUpdate({ questionField: first.key, questionVariants: nextVariants });
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
    // Don't stack empty rows: if a blank variant is already open, keep filling
    // that one. This also absorbs the row seeded on enable, so clicking "Add
    // variant" right after enabling reuses it instead of adding a second.
    if (rows.some((k) => !(variants[k] ?? '').trim())) return;
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
              {sourceOptions && sourceMultiSelect ? (
                <MultiMatchPicker
                  options={sourceOptions}
                  value={key}
                  taken={rows.filter((k) => k !== key)}
                  onChange={(next) => renameVariant(key, next)}
                  m={m}
                />
              ) : sourceOptions ? (
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

          <p
            className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground"
            data-testid="variants-scope-note"
          >
            <i aria-hidden className="pi pi-info-circle mt-0.5" style={{ fontSize: 10 }} />
            {m.scopeNote}
          </p>
          <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
            <i aria-hidden className="pi pi-info-circle mt-0.5" style={{ fontSize: 10 }} />
            {m.interpolationHint}
          </p>
        </>
      ) : null}
    </div>
  );
}
