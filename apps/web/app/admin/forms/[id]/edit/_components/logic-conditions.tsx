'use client';

import { useState } from 'react';
import type { FormStep, StepCondition } from '@quill/engine';
import { cn } from '@/lib/cn';
import { SelectField, TextField } from './fields';
import { hasOptions } from './question-types';
import type { EditorMessages } from './messages';

/**
 * Declarative visibility editor for a question's `showWhen` / `hideWhen`
 * conditions ({field, values[]}): pick an EARLIER question's field, then the
 * answer values that trigger the rule. Choice/dropdown sources offer their
 * options as toggle chips; free-text sources fall back to a comma-separated
 * values input. Honored by the engine's `visibleSteps` on client and server.
 */
export function LogicConditions({
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
  m: EditorMessages['logic'];
}) {
  const prior = steps.slice(0, index);

  if (prior.length === 0) {
    return <p className="text-xs text-muted-foreground">{m.noPriorFields}</p>;
  }

  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-xs text-muted-foreground">{m.hint}</p>
      <ConditionEditor
        label={m.showWhen}
        noneLabel={m.none}
        cond={step.showWhen ?? null}
        prior={prior}
        onChange={(showWhen) => onUpdate({ showWhen: showWhen ?? undefined })}
        m={m}
      />
      <ConditionEditor
        label={m.hideWhen}
        noneLabel={m.hideNone}
        cond={step.hideWhen ?? null}
        prior={prior}
        onChange={(hideWhen) => onUpdate({ hideWhen: hideWhen ?? undefined })}
        m={m}
      />
    </div>
  );
}

/** One condition row: field select (none = rule off) + value picker. */
function ConditionEditor({
  label,
  noneLabel,
  cond,
  prior,
  onChange,
  m,
}: {
  label: string;
  noneLabel: string;
  cond: StepCondition | null;
  prior: FormStep[];
  onChange: (next: StepCondition | null) => void;
  m: EditorMessages['logic'];
}) {
  const NONE = '';
  const source = cond ? prior.find((s) => s.key === cond.field) : undefined;
  const sourceOptions = source && hasOptions(source.type) ? (source.options ?? []) : null;

  function pickField(key: string) {
    if (key === NONE) {
      onChange(null);
      return;
    }
    const next = prior.find((s) => s.key === key);
    if (!next) return;
    // Keep the values when re-picking the same field; otherwise seed a sensible
    // default (the first option) so the rule matches something immediately.
    if (cond && cond.field === key) return;
    const first = hasOptions(next.type) ? next.options?.[0]?.value : undefined;
    onChange({ field: key, values: first ? [first] : [] });
  }

  function toggleValue(value: string) {
    if (!cond) return;
    const has = cond.values.includes(value);
    onChange({ ...cond, values: has ? cond.values.filter((v) => v !== value) : [...cond.values, value] });
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-background p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {cond ? (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-xs text-muted-foreground transition-colors hover:text-destructive focus-visible:outline-none"
          >
            {m.clear}
          </button>
        ) : null}
      </div>
      <SelectField
        aria-label={`${label} — ${m.field}`}
        value={cond?.field ?? NONE}
        onChange={(e) => pickField(e.target.value)}
        className="h-8 py-1 text-xs"
      >
        <option value={NONE}>{noneLabel}</option>
        {prior.map((s, i) => (
          <option key={s.key} value={s.key}>
            {s.question?.trim() || `${i + 1} · ${s.key}`}
          </option>
        ))}
      </SelectField>

      {cond ? (
        sourceOptions ? (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={m.values}>
            {sourceOptions.map((o) => {
              const selected = cond.values.includes(o.value);
              return (
                <button
                  key={o.value}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => toggleValue(o.value)}
                  className={cn(
                    'rounded-md border px-2 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    selected
                      ? 'border-primary bg-primary/10 font-medium text-foreground'
                      : 'border-border text-muted-foreground hover:text-foreground',
                  )}
                >
                  {o.label || o.value}
                </button>
              );
            })}
          </div>
        ) : (
          <FreeValuesInput
            key={cond.field}
            initial={cond.values}
            label={m.values}
            hint={m.valuesHint}
            onCommit={(values) => onChange({ ...cond, values })}
          />
        )
      ) : null}
    </div>
  );
}

/**
 * Comma-separated values input with LOCAL text state — committing the parsed
 * list upward on every keystroke while the visible text stays exactly as typed
 * (a join/split round-trip would eat commas mid-typing). Keyed by the source
 * field so switching fields resets the text.
 */
function FreeValuesInput({
  initial,
  label,
  hint,
  onCommit,
}: {
  initial: string[];
  label: string;
  hint: string;
  onCommit: (values: string[]) => void;
}) {
  const [text, setText] = useState(initial.join(', '));
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      <TextField
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onCommit(
            e.target.value
              .split(',')
              .map((v) => v.trim())
              .filter(Boolean),
          );
        }}
        className="h-8 py-1 text-xs"
      />
      <span className="text-[11px] text-muted-foreground">{hint}</span>
    </label>
  );
}
