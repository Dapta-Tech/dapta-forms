'use client';

import type { StepCondition } from '@quill/engine';
import { SelectField, TextField } from './fields';
import type { EditorMessages } from './messages';

/** A prior step the current step can branch on. */
export interface PriorField {
  key: string;
  label: string;
  options?: { label: string; value: string }[];
}

/**
 * One condition row (used for both `showWhen` and `hideWhen`): pick an earlier
 * field, then the values that trigger it. When that field has options they
 * render as checkboxes; otherwise a comma-separated text input.
 */
export function ConditionEditor({
  label,
  condition,
  priorFields,
  onChange,
  m,
}: {
  label: string;
  condition: StepCondition | null | undefined;
  priorFields: PriorField[];
  onChange: (next: StepCondition | null) => void;
  m: EditorMessages['logic'];
}) {
  const selected = priorFields.find((f) => f.key === condition?.field);
  const values = condition?.values ?? [];

  function pickField(key: string) {
    if (!key) return onChange(null);
    onChange({ field: key, values: [] });
  }
  function toggleValue(value: string) {
    const next = values.includes(value) ? values.filter((v) => v !== value) : [...values, value];
    onChange({ field: condition!.field, values: next });
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <SelectField value={condition?.field ?? ''} onChange={(e) => pickField(e.target.value)}>
        <option value="">{m.none}</option>
        {priorFields.map((f) => (
          <option key={f.key} value={f.key}>
            {f.label}
          </option>
        ))}
      </SelectField>

      {condition ? (
        selected?.options && selected.options.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {selected.options.map((o) => {
              const on = values.includes(o.value);
              return (
                <button
                  key={o.value}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleValue(o.value)}
                  className={
                    'rounded-full border px-3 py-1 text-xs transition-colors ' +
                    (on
                      ? 'border-primary bg-primary/15 text-foreground'
                      : 'border-border text-muted-foreground hover:border-primary')
                  }
                >
                  {o.label || o.value}
                </button>
              );
            })}
          </div>
        ) : (
          <TextField
            value={values.join(', ')}
            placeholder={m.valuesHint}
            onChange={(e) =>
              onChange({
                field: condition.field,
                values: e.target.value
                  .split(',')
                  .map((v) => v.trim())
                  .filter(Boolean),
              })
            }
          />
        )
      ) : null}
    </div>
  );
}
