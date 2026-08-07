'use client';

import type { FormStep } from '@quill/engine';
import { conditionNeverHolds, conditionsContradict } from '@quill/engine';
import { Modal } from '@/components/modal';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { iconForStep } from './question-types';
import { describeCondition, optionLabel, ruleCount } from './logic-util';
import { tb } from './builder-messages';
import type { BuilderMessages } from './builder-messages';

/**
 * The FORM-WIDE branching overview (F3b).
 *
 * The builder can only ever show logic ONE question at a time — the Build
 * panel's settings, the canvas hover button, the per-question `LogicDialog`.
 * Nothing answered "what does this form's branching actually do?" without
 * clicking through every question and holding the answer in your head. This is
 * that missing screen: every step in order, its rules spelled out in plain
 * language, and a control per step that opens the real editor.
 *
 * Two deliberate non-features:
 *  - It does NOT render `LogicDialog` itself. The same dialog opens from the
 *    Build panel and the Logic canvas; mounting a second copy here would be two
 *    editors of one rule, each with its own focus trap and its own idea of which
 *    step is being edited. `onEditStep(index)` hands that decision to the
 *    orchestrator, which already owns it.
 *  - It does NOT re-describe conditions. `describeCondition` (shared with the
 *    Logic map) resolves a stored key + raw values back to the QUESTION TITLE
 *    and the OPTION LABELS the author typed; a second describer here would drift
 *    from the map's wording the first time either was touched.
 */
export function BranchingDialog({
  open,
  onClose,
  steps,
  onEditStep,
  bm,
}: {
  open: boolean;
  onClose: () => void;
  /** Every step in the form, in order — the whole point of the view. */
  steps: FormStep[];
  /**
   * Ask the parent to open the per-question `LogicDialog` for this step. The
   * ONLY editing path: this dialog reads config, it never writes it.
   */
  onEditStep: (index: number) => void;
  bm: BuilderMessages;
}) {
  const b = bm.branching;
  const titleOf = (step: FormStep, i: number) => step.question?.trim() || tb(bm.canvas.questionN, { n: i + 1 });
  const withLogic = steps.filter((s) => ruleCount(s) > 0).length;

  return (
    <Modal open={open} onClose={onClose} title={b.title} labelId="branching-dialog-title" size="xl">
      <div data-testid="branching-dialog" className="flex flex-col gap-4">
        <div>
          <p className="text-xs text-muted-foreground">{b.subtitle}</p>
          <p data-testid="branching-summary" className="mt-1 text-xs font-medium text-foreground">
            {withLogic > 0 ? tb(b.summary, { n: withLogic, total: steps.length }) : b.summaryNone}
          </p>
        </div>

        {steps.length === 0 ? (
          <p
            data-testid="branching-empty"
            className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground"
          >
            {b.empty}
          </p>
        ) : (
          <div className="flex max-h-[62vh] flex-col gap-2.5 overflow-y-auto pr-1">
            {steps.map((step, index) => (
              <StepBlock
                key={step.key}
                step={step}
                index={index}
                steps={steps}
                title={titleOf(step, index)}
                onEdit={() => onEditStep(index)}
                bm={bm}
              />
            ))}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button size="sm" data-testid="branching-dialog-close" onClick={onClose}>
            {bm.logicDialog.done}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * One step as a block: number, type icon, title, rule count, and its rules read
 * back as sentences. A step with NO logic says so in words rather than showing
 * an empty rule editor — an empty editor reads as broken, a sentence reads as
 * "nothing to see here, and that is fine".
 */
function StepBlock({
  step,
  index,
  steps,
  title,
  onEdit,
  bm,
}: {
  step: FormStep;
  index: number;
  steps: FormStep[];
  title: string;
  onEdit: () => void;
  bm: BuilderMessages;
}) {
  const rules = ruleCount(step);
  const branches = step.goto ?? [];
  // Same audit the Logic map runs: rules that cancel out (or an operand still
  // "(not set)") mean the step can never be shown. Staying silent here would
  // send the author back to the Build panel to discover it one question at a
  // time — exactly the walk this dialog exists to remove.
  const never = conditionsContradict(step.showWhen, step.hideWhen) || conditionNeverHolds(step.showWhen);

  return (
    <div
      data-testid="branching-step"
      data-step-key={step.key}
      data-rule-count={rules}
      className={cn(
        'rounded-xl border bg-background p-3.5',
        rules > 0 ? 'border-secondary/45' : 'border-border',
      )}
    >
      <div className="flex items-center gap-3">
        <span
          data-testid="branching-step-number"
          className={cn(
            'inline-flex h-6 min-w-[1.5rem] shrink-0 items-center justify-center rounded px-1 text-xs font-bold tabular-nums',
            rules > 0 ? 'bg-secondary/15 text-secondary' : 'bg-muted text-muted-foreground',
          )}
        >
          {index + 1}
        </span>
        <i aria-hidden className={`pi ${iconForStep(step)} shrink-0 text-muted-foreground`} style={{ fontSize: 12 }} />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{title}</span>
        {step.hidden ? (
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {bm.badges.hidden}
          </span>
        ) : null}
        {rules > 0 ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-secondary/40 bg-secondary/10 px-1.5 py-0.5 text-[11px] font-semibold text-secondary">
            <i aria-hidden className="pi pi-directions" style={{ fontSize: 9 }} />
            {rules === 1 ? bm.badges.ruleOne : tb(bm.badges.rules, { n: rules })}
          </span>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          data-testid="branching-edit"
          aria-label={tb(bm.branching.editAria, { question: title })}
          onClick={onEdit}
          className="shrink-0"
        >
          <i aria-hidden className="pi pi-pencil" style={{ fontSize: 10 }} />
          {bm.branching.edit}
        </Button>
      </div>

      {rules === 0 ? (
        <p data-testid="branching-step-empty" className="mt-2 pl-[calc(1.5rem+0.75rem)] text-[11px] text-muted-foreground">
          {bm.logicDialog.empty}
        </p>
      ) : (
        <div className="mt-2.5 flex flex-col gap-1.5 border-t border-border/60 pt-2.5">
          {never ? (
            <p
              data-testid="branching-never-appears"
              className="flex items-start gap-1.5 rounded-md bg-destructive/10 px-2 py-1 text-[11px] font-medium leading-relaxed text-destructive"
            >
              <i aria-hidden className="pi pi-exclamation-triangle mt-0.5 shrink-0" style={{ fontSize: 10 }} />
              {bm.map.neverAppears}
            </p>
          ) : null}
          {step.showWhen ? <ConditionLine kind="show" cond={step.showWhen} steps={steps} bm={bm} /> : null}
          {step.hideWhen ? <ConditionLine kind="hide" cond={step.hideWhen} steps={steps} bm={bm} /> : null}
          {branches.map((rule, ri) => (
            <BranchLine key={ri} step={step} rule={rule} steps={steps} bm={bm} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * A `showWhen`/`hideWhen` rule as a sentence, worded exactly like the Logic map
 * (same `describeCondition`, same operator strings) so the two surfaces never
 * disagree about what a rule says.
 */
function ConditionLine({
  kind,
  cond,
  steps,
  bm,
}: {
  kind: 'show' | 'hide';
  cond: NonNullable<FormStep['showWhen']>;
  steps: FormStep[];
  bm: BuilderMessages;
}) {
  const d = describeCondition(cond, steps, {
    fallbackQuestion: (i) => tb(bm.canvas.questionN, { n: i + 1 }),
    opIn: bm.map.condIn,
    opEq: bm.map.condEq,
    opGt: bm.map.condGt,
    opLt: bm.map.condLt,
    opBetween: bm.map.condBetween,
    and: bm.map.condAnd,
    blank: bm.map.condBlank,
    score: bm.map.condScore,
  });
  const show = kind === 'show';
  return (
    <p
      data-testid={`branching-cond-${kind}`}
      className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-[11px] leading-relaxed"
    >
      <span
        className={cn(
          'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide',
          show ? 'bg-secondary/15 text-secondary' : 'bg-destructive/15 text-destructive',
        )}
      >
        {show ? bm.map.condShowIf : bm.map.condHideIf}
      </span>
      <span className="font-semibold text-foreground">{d.field}</span>
      <span className="text-muted-foreground">{d.operator}</span>
      <span className="font-medium text-foreground">{d.operand}</span>
      {d.dangling ? (
        <span
          data-testid="branching-cond-dangling"
          className="rounded bg-destructive/15 px-1.5 py-0.5 text-[10px] font-semibold text-destructive"
        >
          {bm.map.condMissingField}
        </span>
      ) : null}
    </p>
  );
}

/**
 * A forward `goto` rule as a sentence, reusing the map's own edge phrasing
 * ("If {value} → skip to end" / "If {value} → {target}"). Values resolve to
 * OPTION LABELS: the stored config holds raw values, which is not what the
 * author typed or recognizes.
 */
function BranchLine({
  step,
  rule,
  steps,
  bm,
}: {
  step: FormStep;
  rule: NonNullable<FormStep['goto']>[number];
  steps: FormStep[];
  bm: BuilderMessages;
}) {
  // A scheduler routes on the catch-all `*` — there is no option to label, and
  // printing a literal "*" as if it were an answer the respondent could give
  // would be a lie (a scheduler's rule fires on a booking, not an answer).
  const catchAll = rule.values.includes('*');
  const value = catchAll
    ? step.type === 'scheduler'
      ? bm.branching.anyBooking
      : bm.branching.anyAnswer
    : rule.values.map((v) => optionLabel(step, v)).join(', ') || bm.map.condBlank;
  const targetIndex = rule.target == null ? -1 : steps.findIndex((s) => s.key === rule.target);
  const targetStep = targetIndex >= 0 ? steps[targetIndex] : undefined;
  const label =
    rule.target == null
      ? tb(bm.map.skipEdge, { value })
      : tb(bm.map.jumpEdge, {
          value,
          target: targetStep
            ? targetStep.question?.trim() || tb(bm.canvas.questionN, { n: targetIndex + 1 })
            : rule.target,
        });
  return (
    <p
      data-testid="branching-branch"
      className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-[11px] leading-relaxed"
    >
      <span className="shrink-0 rounded bg-secondary/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-secondary">
        <i aria-hidden className="pi pi-bolt" style={{ fontSize: 9 }} />
      </span>
      <span className="font-medium text-foreground">{label}</span>
      {/* A jump whose target no longer exists never fires — the same dangling
          failure `describeCondition` flags for conditions, which nothing was
          checking on the routing side. */}
      {rule.target != null && !targetStep ? (
        <span
          data-testid="branching-branch-dangling"
          className="rounded bg-destructive/15 px-1.5 py-0.5 text-[10px] font-semibold text-destructive"
        >
          {bm.map.condMissingField}
        </span>
      ) : null}
    </p>
  );
}
