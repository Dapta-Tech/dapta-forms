'use client';

import type { FormStep } from '@quill/engine';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { SelectField, TextField, TextArea, InlineField } from './fields';
import type { PriorField } from './condition-editor';
import type { EditorMessages } from './messages';

/**
 * Dynamic-question editor: vary a step's question by the answer to an earlier
 * field. Variants are stored as `questionVariants` (value → text), with `*` as
 * the fallback. `[field]` interpolation is available in every variant.
 */
export function QuestionVariantsEditor({
  step,
  priorFields,
  onUpdate,
  m,
}: {
  step: FormStep;
  priorFields: PriorField[];
  onUpdate: (patch: Partial<FormStep>) => void;
  m: EditorMessages['variants'];
}) {
  const enabled = !!step.questionField;
  const variants = step.questionVariants ?? {};
  // Editable pairs excluding the special `*` fallback key.
  const pairs = Object.entries(variants).filter(([k]) => k !== '*');
  const fallback = variants['*'] ?? '';

  function setVariants(next: Record<string, string>) {
    onUpdate({ questionVariants: next });
  }
  function enable(on: boolean) {
    if (on) onUpdate({ questionField: priorFields[0]?.key ?? '', questionVariants: variants });
    else onUpdate({ questionField: null, questionVariants: undefined });
  }
  function updateKey(oldKey: string, newKey: string) {
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries(variants)) next[k === oldKey ? newKey : k] = v;
    setVariants(next);
  }
  function updateValue(key: string, text: string) {
    setVariants({ ...variants, [key]: text });
  }
  function remove(key: string) {
    const next = { ...variants };
    delete next[key];
    setVariants(next);
  }

  return (
    <div className="flex flex-col gap-3">
      <InlineField label={m.enable} hint={m.hint}>
        <Switch checked={enabled} onCheckedChange={enable} aria-label={m.enable} />
      </InlineField>

      {enabled ? (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">{m.field}</span>
            <SelectField
              value={step.questionField ?? ''}
              onChange={(e) => onUpdate({ questionField: e.target.value })}
            >
              {priorFields.length === 0 ? <option value="">—</option> : null}
              {priorFields.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </SelectField>
          </label>

          {pairs.map(([key, text], i) => (
            <div key={i} className="flex flex-col gap-1.5 rounded-md border border-border bg-background p-2">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-medium text-muted-foreground">{m.matchValue}</span>
                <TextField
                  value={key}
                  placeholder={m.matchValuePlaceholder}
                  onChange={(e) => updateKey(key, e.target.value)}
                  className="flex-1"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={m.remove}
                  onClick={() => remove(key)}
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                >
                  <i aria-hidden className="pi pi-trash" style={{ fontSize: 13 }} />
                </Button>
              </div>
              <TextArea
                value={text}
                rows={2}
                placeholder={m.variantQuestion}
                onChange={(e) => updateValue(key, e.target.value)}
              />
            </div>
          ))}

          <div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setVariants({ ...variants, '': '' })}
              disabled={'' in variants}
            >
              <i aria-hidden className="pi pi-plus" style={{ fontSize: 11 }} /> {m.add}
            </Button>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">{m.fallback}</span>
            <TextArea
              value={fallback}
              rows={2}
              onChange={(e) => updateValue('*', e.target.value)}
            />
          </label>
          <p className="text-xs text-muted-foreground">{m.interpolationHint}</p>
        </div>
      ) : null}
    </div>
  );
}
