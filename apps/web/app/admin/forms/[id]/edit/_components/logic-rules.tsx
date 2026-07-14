'use client';

import type { FormStep, GotoRule } from '@quill/engine';
import { Button } from '@/components/ui/button';
import { SelectField } from './fields';
import { jumpTargetsAfter } from './logic-util';
import type { BuilderMessages } from './builder-messages';

/**
 * Inline forward-logic editor (right pane, per question): plain-language rule
 * rows — "If answer is [value] then [jump to Q / skip to end]". Compiles to the
 * question's additive `goto` array; first match wins. Only offered on choice /
 * dropdown questions (a rule needs discrete answer values to match on).
 */
export function LogicRules({
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
  m: BuilderMessages;
}) {
  const rules = step.goto ?? [];
  const options = step.options ?? [];
  const targets = jumpTargetsAfter(steps, index, m.canvas.questionN.replace(' {n}', ''));

  const SKIP = '__end__';

  function setRules(next: GotoRule[]) {
    onUpdate({ goto: next.length ? next : undefined });
  }
  function addRule() {
    const firstValue = options[0]?.value ?? '';
    setRules([...rules, { values: firstValue ? [firstValue] : [], target: targets[0]?.key ?? null }]);
  }
  function update(i: number, patch: Partial<GotoRule>) {
    setRules(rules.map((r, ri) => (ri === i ? { ...r, ...patch } : r)));
  }
  function remove(i: number) {
    setRules(rules.filter((_, ri) => ri !== i));
  }

  return (
    <div className="flex flex-col gap-2.5">
      {rules.map((rule, i) => {
        const value = rule.values[0] ?? '';
        const targetValue = rule.target == null ? SKIP : rule.target;
        return (
          <div key={i} className="flex flex-col gap-2 rounded-lg border border-border bg-background p-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">{m.rules.ifAnswerIs}</span>
              <button
                type="button"
                aria-label={m.rules.remove}
                onClick={() => remove(i)}
                className="text-muted-foreground transition-colors hover:text-destructive focus-visible:outline-none"
              >
                <i aria-hidden className="pi pi-times" style={{ fontSize: 11 }} />
              </button>
            </div>
            <SelectField
              aria-label={m.rules.chooseValue}
              value={value}
              onChange={(e) => update(i, { values: e.target.value ? [e.target.value] : [] })}
              className="h-8 py-1 text-xs"
            >
              <option value="">{m.rules.chooseValue}</option>
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label || o.value}
                </option>
              ))}
            </SelectField>
            <div className="flex items-center gap-2">
              <span className="shrink-0 text-xs text-muted-foreground">{m.rules.then}</span>
              <SelectField
                aria-label={m.rules.then}
                value={targetValue}
                onChange={(e) => update(i, { target: e.target.value === SKIP ? null : e.target.value })}
                className="h-8 py-1 text-xs"
              >
                <option value={SKIP}>→ {m.rules.skipToEnd}</option>
                {targets.map((t) => (
                  <option key={t.key} value={t.key}>
                    ⚡ {m.rules.jumpTo} {t.label}
                  </option>
                ))}
              </SelectField>
            </div>
          </div>
        );
      })}

      <Button variant="outline" size="sm" onClick={addRule} className="self-start" disabled={options.length === 0}>
        <i aria-hidden className="pi pi-plus" style={{ fontSize: 11 }} /> {m.rules.add}
      </Button>

      {rules.length > 0 ? (
        <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
          <i aria-hidden className="pi pi-info-circle mt-0.5" style={{ fontSize: 10 }} />
          {m.rules.firstMatchWins}
        </p>
      ) : null}
    </div>
  );
}
