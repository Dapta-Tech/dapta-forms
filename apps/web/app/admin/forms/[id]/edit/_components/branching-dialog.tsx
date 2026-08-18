'use client';

import type { FormStep, GotoRule } from '@quill/engine';
import { conditionNeverHolds, conditionsContradict } from '@quill/engine';
import { Modal } from '@/components/modal';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { SelectField } from './fields';
import { iconForStep, hasOptions } from './question-types';
import { GOTO_END, GOTO_NEXT, alwaysValueOf, buildGoto, catchAllFires, jumpTargetsAfter, liveRuleCount, splitGoto } from './logic-util';
import { LogicRules } from './logic-rules';
import { LogicConditions } from './logic-conditions';
import { tb } from './builder-messages';
import type { BuilderMessages } from './builder-messages';
import type { EditorMessages } from './messages';

/**
 * The FORM-WIDE branching editor (F3b, reworked by R7).
 *
 * The first version listed each step's rules as sentences and sent you to an
 * Edit button — a second dialog, two hops from the thing you wanted to change.
 * The feedback was direct: the rules should be EDITABLE HERE, with dropdowns,
 * the way Typeform's Branching panel works. So every block now IS the editor:
 *
 *  - **"Always go to"** — one select per question that CAN take one. It reads
 *    and writes the catch-all `goto` rule (`values: ['*']`, which the engine
 *    resolves as "any answer at all"). Empty = continue in order, i.e. no rule
 *    stored. A message card and a reveal are the exception: they record no
 *    answer, so the engine can never match `*` on them and the select would
 *    author a jump that provably never fires — it is simply absent there.
 *  - **Value rules** — the same `LogicRules` rows the per-question dialog uses,
 *    inline, only on types with discrete answer values.
 *  - **Visibility** — the same `LogicConditions` editors, inline.
 *
 * And a deliberate silence: no capability lectures. A free-text question simply
 * shows no value-rule editor — it does not explain that it has no answer values
 * to branch on; the first question simply shows no visibility section — it does
 * not explain that nothing precedes it. What CAN be configured is offered;
 * what cannot is absent. Warnings remain only where a CONFIGURED rule is broken
 * (contradiction, never-holds, dangling target) — that is audit, not lecture.
 *
 * Ordering is load-bearing: the engine walks `goto` rules in order and the
 * first match wins, and the catch-all matches ANY answer — so it is always
 * written LAST, or it would swallow every value rule above it.
 */
export function BranchingDialog({
  open,
  onClose,
  steps,
  scoringEnabled,
  onUpdateStep,
  bm,
  em,
}: {
  open: boolean;
  onClose: () => void;
  /** Every step in the form, in order — the whole point of the view. */
  steps: FormStep[];
  /** Form-level scoring switch, threaded to the visibility editors. */
  scoringEnabled: boolean;
  /** Patch ONE step — maps 1:1 onto the editor's `patchStep`. */
  onUpdateStep: (index: number, patch: Partial<FormStep>) => void;
  bm: BuilderMessages;
  em: EditorMessages;
}) {
  const b = bm.branching;
  const titleOf = (step: FormStep, i: number) =>
    step.question?.trim() || tb(bm.canvas.questionN, { n: i + 1 });
  // Rules that can never fire do not make a question "carry logic" — see
  // {@link liveRuleCount}.
  const withLogic = steps.filter((s) => liveRuleCount(s) > 0).length;

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
                scoringEnabled={scoringEnabled}
                title={titleOf(step, index)}
                onUpdate={(patch) => onUpdateStep(index, patch)}
                bm={bm}
                em={em}
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
 * One step as an inline editor block: header, then the Always-go-to select,
 * then whatever else this TYPE can configure. The block never explains an
 * absent control — absence is the explanation.
 */
function StepBlock({
  step,
  index,
  steps,
  scoringEnabled,
  title,
  onUpdate,
  bm,
  em,
}: {
  step: FormStep;
  index: number;
  steps: FormStep[];
  scoringEnabled: boolean;
  title: string;
  onUpdate: (patch: Partial<FormStep>) => void;
  bm: BuilderMessages;
  em: EditorMessages;
}) {
  const b = bm.branching;
  const rules = liveRuleCount(step);
  const routable = hasOptions(step.type);
  const targets = jumpTargetsAfter(steps, index, bm.canvas.questionN.replace(' {n}', ''));
  // Same audit the Logic map runs — a step whose rules cancel out never shows.
  const never = conditionsContradict(step.showWhen, step.hideWhen) || conditionNeverHolds(step.showWhen);

  // Shared with the per-question dialog: the same split, the same sentinels,
  // the same rebuild — one array, two doors.
  const { valueRules, catchAll } = splitGoto(step);
  const alwaysValue = alwaysValueOf(catchAll);
  // A message and a reveal record no answer, so `*` can never match on one:
  // the select would author a jump that provably never fires.
  const always = catchAllFires(step);
  // Everything under the header line. On a first-step message that is nothing
  // at all — and an empty ruled box reads as a broken control, not as "there
  // is nothing to configure here".
  const body = always || routable || never || index > 0;

  /** Rebuild `goto` from parts — value rules first, catch-all LAST (it matches
   *  any answer, so anywhere earlier it would swallow the rules above it). */
  function writeGoto(nextValueRules: GotoRule[], nextAlways: string) {
    onUpdate({ goto: buildGoto(nextValueRules, nextAlways) });
  }

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
            'inline-flex h-6 min-w-[1.5rem] shrink-0 items-center justify-center rounded-sm px-1 text-xs font-bold tabular-nums',
            rules > 0 ? 'bg-secondary/15 text-secondary' : 'bg-muted text-muted-foreground',
          )}
        >
          {index + 1}
        </span>
        <i aria-hidden className={`pi ${iconForStep(step)} shrink-0 text-muted-foreground`} style={{ fontSize: 12 }} />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{title}</span>
        {step.hidden ? (
          <span className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-wide text-faint">
            {bm.badges.hidden}
          </span>
        ) : null}
        {rules > 0 ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-secondary/40 bg-secondary/10 px-1.5 py-0.5 text-xs font-semibold text-secondary">
            <i aria-hidden className="pi pi-directions" style={{ fontSize: 9 }} />
            {rules === 1 ? bm.badges.ruleOne : tb(bm.badges.rules, { n: rules })}
          </span>
        ) : null}
      </div>

      {body ? (
        <div className="mt-2.5 flex flex-col gap-2.5 border-t border-border/60 pt-2.5">
          {never ? (
            <p
              data-testid="branching-never-appears"
              className="flex items-start gap-1.5 rounded-md bg-destructive/10 px-2 py-1 text-xs font-medium leading-relaxed text-destructive"
            >
              <i aria-hidden className="pi pi-exclamation-triangle mt-0.5 shrink-0" style={{ fontSize: 10 }} />
              {bm.map.neverAppears}
            </p>
          ) : null}

          {/* Always go to — `*` is "any answer" to the engine, so every question
              that HAS an answer gets this row, scheduler included (there it reads
              as "after the booking"). A message or a reveal gets nothing: the
              rule could not fire, and by this dialog's rule the absence is the
              whole explanation. */}
          {always ? (
            <div className="flex items-center gap-2">
              <span className="shrink-0 text-xs text-muted-foreground">
                {step.type === 'scheduler' ? bm.logicDialog.booking : b.alwaysGoTo}
              </span>
              {/* The testid lives on a wrapper: SelectField renders the branded
                  combobox and forwards only a fixed prop set — a testid handed to
                  it would silently vanish. */}
              <div data-testid="branching-always" className="w-full max-w-[340px]">
                <SelectField
                  aria-label={`${b.alwaysGoTo}: ${title}`}
                  value={alwaysValue}
                  onChange={(e) => writeGoto(valueRules, e.target.value)}
                  className="h-8 py-1 text-xs"
                >
                  <option value={GOTO_NEXT}>{b.nextInOrder}</option>
                  {targets.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label}
                    </option>
                  ))}
                  <option value={GOTO_END}>{b.endOfForm}</option>
                </SelectField>
              </div>
            </div>
          ) : null}

          {/* Value rules — only where the type HAS discrete values. The catch-all
              is split out above, so LogicRules sees (and edits) only real value
              rules; its writes are re-merged with the catch-all kept last. */}
          {routable ? (
            <div data-testid="branching-rules">
              <LogicRules
                step={{ ...step, goto: valueRules.length ? valueRules : undefined }}
                index={index}
                steps={steps}
                onUpdate={(patch) => writeGoto(patch.goto ?? [], alwaysValue)}
                m={bm}
              />
            </div>
          ) : null}

          {/* Visibility — absent on the first step (nothing precedes it), never
              explained away with a sentence. */}
          {index > 0 ? (
            <div data-testid="branching-visibility" className="border-t border-border/60 pt-2.5">
              <LogicConditions
                step={step}
                index={index}
                steps={steps}
                scoringEnabled={scoringEnabled}
                onUpdate={onUpdate}
                m={em.logic}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
