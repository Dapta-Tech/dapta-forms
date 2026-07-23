'use client';

import { useState } from 'react';
import {
  conditionsContradict,
  conditionsNarrow,
  conditionNeverHolds,
  operatorsForFieldType,
  type ConditionOp,
  type FormStep,
  type StepCondition,
} from '@quill/engine';
import { cn } from '@/lib/cn';
import { SelectField, TextField } from './fields';
import { hasOptions } from './question-types';
import type { EditorMessages } from './messages';

type LogicMessages = EditorMessages['logic'];

/**
 * Declarative visibility editor for a question's `showWhen` / `hideWhen`
 * conditions: pick an EARLIER question's field, then how its answer is compared.
 * The operators offered follow the referenced field's TYPE (engine
 * `operatorsForFieldType`): choice/dropdown/text sources keep "matches any of"
 * (`in`) — option chips or a comma-separated values input; number/slider sources
 * get a comparison dropdown (equal / greater / less / between) with numeric
 * operand inputs. A contradiction guard (V4-08) warns when the show + hide rules
 * on a step cancel out so it could never appear. Honored by the engine's
 * `visibleSteps` on client and server.
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
  m: LogicMessages;
}) {
  const prior = steps.slice(0, index);

  if (prior.length === 0) {
    return <p className="text-xs text-muted-foreground">{m.noPriorFields}</p>;
  }

  // V4-08 guard: show + hide targeting the same field with an overlapping
  // condition can never be visible (hide wins). Pure engine helper; we warn
  // prominently and keep the offending rules visible so either can be fixed.
  const contradiction = conditionsContradict(step.showWhen, step.hideWhen);
  // V5-A6: the softer case the hard guard stays silent on — the rules overlap
  // only partially, so the question DOES appear, but in a much narrower window
  // than reading the show rule alone suggests. The two rules sit in separate
  // boxes, so nothing on screen made that visible. Advisory, never an error.
  const narrow = contradiction ? null : conditionsNarrow(step.showWhen, step.hideWhen);
  // V5-QA: a rule the engine can never satisfy. On the SHOW side that hides the
  // question from every respondent — the same outcome as a contradiction, and it
  // was equally invisible; an unfinished operand read as a configured rule. On
  // the HIDE side it is merely inert, so it gets a softer note.
  const showBroken = conditionNeverHolds(step.showWhen);
  const hideBroken = conditionNeverHolds(step.hideWhen);
  const brokenCopy =
    showBroken === 'missing_operand'
      ? m.neverShowMissing
      : showBroken === 'empty_interval'
        ? m.neverShowEmpty
        : showBroken === 'no_values'
          ? m.neverShowNoValues
          : null;

  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-xs text-muted-foreground">{m.hint}</p>
      <ConditionEditor
        testid="logic-show"
        label={m.showWhen}
        noneLabel={m.none}
        cond={step.showWhen ?? null}
        prior={prior}
        onChange={(showWhen) => onUpdate({ showWhen: showWhen ?? undefined })}
        m={m}
      />
      <ConditionEditor
        testid="logic-hide"
        label={m.hideWhen}
        noneLabel={m.hideNone}
        cond={step.hideWhen ?? null}
        prior={prior}
        onChange={(hideWhen) => onUpdate({ hideWhen: hideWhen ?? undefined })}
        m={m}
      />
      {contradiction ? (
        <p
          role="alert"
          data-testid="logic-contradiction"
          className="rounded-md border border-destructive/50 bg-destructive/10 px-2.5 py-2 text-xs font-medium text-destructive"
        >
          {m.contradiction}
        </p>
      ) : null}
      {brokenCopy ? (
        <p
          role="alert"
          data-testid="logic-never-shows"
          className="rounded-md border border-destructive/50 bg-destructive/10 px-2.5 py-2 text-xs font-medium text-destructive"
        >
          {brokenCopy}
        </p>
      ) : null}
      {hideBroken ? (
        <p
          data-testid="logic-hide-inert"
          className="flex items-start gap-1.5 rounded-md border border-secondary/40 bg-secondary/10 px-2.5 py-2 text-xs leading-relaxed text-foreground"
        >
          <i aria-hidden className="pi pi-info-circle mt-0.5 shrink-0 text-secondary" style={{ fontSize: 11 }} />
          <span>{m.hideRuleInert}</span>
        </p>
      ) : null}
      {narrow ? (
        <p
          data-testid="logic-narrow"
          className="flex items-start gap-1.5 rounded-md border border-secondary/40 bg-secondary/10 px-2.5 py-2 text-xs leading-relaxed text-foreground"
        >
          <i aria-hidden className="pi pi-info-circle mt-0.5 shrink-0 text-secondary" style={{ fontSize: 11 }} />
          <span>{m.narrow.replace('{lo}', String(narrow.lo)).replace('{hi}', String(narrow.hi))}</span>
        </p>
      ) : null}
    </div>
  );
}

/** The localized label for one operator (the numeric ops + `in` fallback). */
function opLabel(op: ConditionOp, m: LogicMessages): string {
  switch (op) {
    case 'eq':
      return m.opEq;
    case 'gt':
      return m.opGt;
    case 'lt':
      return m.opLt;
    case 'between':
      return m.opBetween;
    default:
      return m.values; // 'in' — "matches any of"
  }
}

/** One condition row: field select (none = rule off) + operator/value picker. */
function ConditionEditor({
  testid,
  label,
  noneLabel,
  cond,
  prior,
  onChange,
  m,
}: {
  testid: string;
  label: string;
  noneLabel: string;
  cond: StepCondition | null;
  prior: FormStep[];
  onChange: (next: StepCondition | null) => void;
  m: LogicMessages;
}) {
  const NONE = '';
  const source = cond ? prior.find((s) => s.key === cond.field) : undefined;
  const ops: ConditionOp[] = source ? operatorsForFieldType(source.type) : ['in'];
  // Numeric sources (slider) expose the comparison operators; everything else
  // keeps the single `in` ("matches any of") behavior with no operator UI.
  const numeric = ops[0] !== 'in';
  const op: ConditionOp = cond?.op ?? ops[0] ?? 'in';
  const sourceOptions = source && hasOptions(source.type) ? (source.options ?? []) : null;

  function pickField(key: string) {
    if (key === NONE) {
      onChange(null);
      return;
    }
    const next = prior.find((s) => s.key === key);
    if (!next) return;
    // Keep the operands when re-picking the same field.
    if (cond && cond.field === key) return;
    const nextOps = operatorsForFieldType(next.type);
    if (nextOps[0] !== 'in') {
      // Numeric source: seed the first comparison op (operand typed next).
      onChange({ field: key, values: [], op: nextOps[0] });
      return;
    }
    // Choice source: seed the first option so the rule matches something
    // immediately. Free-text sources start with an empty list.
    const first = hasOptions(next.type) ? next.options?.[0]?.value : undefined;
    onChange({ field: key, values: first ? [first] : [] });
  }

  function toggleValue(value: string) {
    if (!cond) return;
    const values = cond.values ?? [];
    const has = values.includes(value);
    onChange({ ...cond, values: has ? values.filter((v) => v !== value) : [...values, value] });
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
        numeric ? (
          <div className="flex flex-col gap-2">
            <div data-testid={`${testid}-op`}>
              <SelectField
                aria-label={`${label} — ${m.operator}`}
                value={op}
                onChange={(e) => onChange({ ...cond, op: e.target.value as ConditionOp })}
                className="h-8 py-1 text-xs"
              >
                {ops.map((o) => (
                  <option key={o} value={o}>
                    {opLabel(o, m)}
                  </option>
                ))}
              </SelectField>
            </div>
            {op === 'between' ? (
              <div className="flex items-end gap-2">
                <NumberOperand
                  key={`${cond.field}-min`}
                  initial={cond.min}
                  label={m.betweenMin}
                  ariaLabel={`${label} — ${m.betweenMin}`}
                  testid={`${testid}-min`}
                  onCommit={(n) => onChange({ ...cond, min: n })}
                />
                <NumberOperand
                  key={`${cond.field}-max`}
                  initial={cond.max}
                  label={m.betweenMax}
                  ariaLabel={`${label} — ${m.betweenMax}`}
                  testid={`${testid}-max`}
                  onCommit={(n) => onChange({ ...cond, max: n })}
                />
              </div>
            ) : (
              <NumberOperand
                key={`${cond.field}-value`}
                initial={cond.value}
                label={m.value}
                ariaLabel={`${label} — ${m.value}`}
                testid={`${testid}-value`}
                onCommit={(n) => onChange({ ...cond, value: n })}
              />
            )}
          </div>
        ) : sourceOptions ? (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={m.values}>
            {sourceOptions.map((o) => {
              const selected = (cond.values ?? []).includes(o.value);
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
            initial={cond.values ?? []}
            label={m.values}
            hint={m.valuesHint}
            onCommit={(values) => onChange({ ...cond, values })}
          />
        )
      ) : null}
    </div>
  );
}

const numberControl =
  'h-8 w-full rounded-md border border-input bg-background px-3 py-1 text-xs transition-colors ' +
  'placeholder:text-muted-foreground hover:border-muted-foreground ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/**
 * A numeric operand input (eq/gt/lt value, or one side of a `between`) with
 * LOCAL text state — the visible text stays exactly as typed while a parsed,
 * finite number (or `undefined` for empty/partial input) commits upward. Keyed
 * by the source field so switching fields reseeds it.
 */
function NumberOperand({
  initial,
  label,
  ariaLabel,
  testid,
  onCommit,
}: {
  initial: number | undefined;
  label: string;
  ariaLabel: string;
  testid: string;
  onCommit: (n: number | undefined) => void;
}) {
  const [text, setText] = useState(initial == null ? '' : String(initial));
  return (
    <label className="flex flex-1 flex-col gap-1">
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      <input
        type="number"
        inputMode="decimal"
        aria-label={ariaLabel}
        data-testid={testid}
        value={text}
        onChange={(e) => {
          const raw = e.target.value;
          setText(raw);
          const n = raw.trim() === '' ? undefined : Number(raw);
          onCommit(n != null && Number.isFinite(n) ? n : undefined);
        }}
        className={numberControl}
      />
    </label>
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
