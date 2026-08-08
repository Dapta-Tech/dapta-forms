'use client';

import type { FormStep, GotoRule } from '@quill/engine';
import { Modal } from '@/components/modal';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { SelectField } from './fields';
import { LogicConditions } from './logic-conditions';
import { LogicRules } from './logic-rules';
import { hasOptions, stepListLabel } from './question-types';
import {
  GOTO_END,
  GOTO_NEXT,
  alwaysValueOf,
  buildGoto,
  catchAllFires,
  jumpTargetsAfter,
  liveRuleCount,
  splitGoto,
} from './logic-util';
import { maxScoreForSteps } from './scoring-util';
import { tb } from './builder-messages';
import type { BuilderMessages } from './builder-messages';
import type { EditorMessages } from './messages';

/**
 * ONE question's whole routing story, in one modal.
 *
 * A question's logic used to be authored in four disconnected places: the
 * forward `goto` rules in the Build panel, the `showWhen`/`hideWhen` conditions
 * buried inside a COLLAPSED advanced accordion, the scheduler's after-booking
 * jump inside its own panel, and outcomes over on the Results tab. Authoring a
 * single branch meant touching four surfaces across two tabs, and the `@score`
 * threshold was typed blind because nothing on screen said how many points were
 * even reachable by the time a respondent got here.
 *
 * This dialog gathers the three that belong to the STEP (visibility, routing,
 * after-booking) and prints the score ceiling above them. It is deliberately a
 * pure, self-contained component — props in, `onUpdate` out — because it opens
 * from three entry points (the Build settings panel, the Logic canvas node, and
 * the form-wide Branching dialog) and must own no data fetching and no tab
 * state.
 *
 * Edits apply LIVE: the editor autosaves on a debounce, so there is no draft
 * state and no Save button here — the footer button just closes.
 */

/** Sentinel for "end the form here" in the After-booking picker (mirrors {@link SchedulerPanel}). */
const AFTER_SUBMIT = '__submit__';

/* ------------------------------------------------------------------ *
 * The shared `goto` vocabulary.
 *
 * A step's `goto` array holds TWO different things that two different
 * controls edit: value rules ("if Enterprise → Q4") and at most one
 * CATCH-ALL (`values: ['*']`, "any answer at all"). Both this dialog and the
 * form-wide Branching dialog are doors onto the same array, so the split, the
 * select sentinels and the rebuild live here once — two implementations would
 * drift, and drift here means one door silently rewriting what the other
 * wrote (the catch-all landing anywhere but last swallows every rule above it,
 * because the engine takes the first match).
 * ------------------------------------------------------------------ */

/* The goto vocabulary moved to `logic-util.ts` — it is read by pure,
 * non-React modules (the canvas layout) and written by the scheduler panel
 * too, none of which should import a dialog component to reach it. */

export function LogicDialog({
  open,
  onClose,
  step,
  index,
  steps,
  scoringEnabled,
  onUpdate,
  bm,
  em,
}: {
  open: boolean;
  onClose: () => void;
  step: FormStep;
  /** This step's position in `steps` — what "earlier" and "later" mean. */
  index: number;
  steps: FormStep[];
  /** Form-level scoring switch — off means every score gate would read 0. */
  scoringEnabled: boolean;
  /** The ONLY mutation path. The dialog never writes config itself. */
  onUpdate: (patch: Partial<FormStep>) => void;
  bm: BuilderMessages;
  em: EditorMessages;
}) {
  const d = bm.logicDialog;
  // A scheduler's answer is a booking, not an option value: there is nothing
  // discrete to match a `goto` rule on, so it routes from its own catch-all
  // picker instead of the value-based rule editor.
  const scheduler = step.type === 'scheduler';
  const routable = hasOptions(step.type);

  // How many points a respondent could have banked by the time they REACH this
  // step — the number a `@score` threshold in the visibility rules is compared
  // against. Without it an author is guessing at their own scale. Gated on the
  // form-level switch for the same reason `LogicConditions` gates the score
  // source: with scoring off, every gate reads a constant 0.
  const priorMax = scoringEnabled ? maxScoreForSteps(steps.slice(0, index)) : 0;

  // Only steps AFTER this one are legal forward jump targets — the same list,
  // with the same labels, the Branching dialog offers, so the two doors onto
  // one rule can never disagree about where it may point.
  const laterSteps = jumpTargetsAfter(steps, index, bm.canvas.questionN.replace(' {n}', ''));

  // The catch-all is NOT a value rule: it belongs to the Always-go-to select
  // (the After-booking picker on a scheduler), never to the rule editor, which
  // would render it as a `<select>` with no matching option — blank, and
  // rewriting the author's "any answer" into a single value on first touch.
  const { valueRules, catchAll } = splitGoto(step);
  const alwaysValue = alwaysValueOf(catchAll);
  const afterValue = !catchAll ? '' : (catchAll.target ?? AFTER_SUBMIT);
  // A step that records no answer can never match `*`, so it is offered no
  // Always-go-to at all (see {@link catchAllFires}).
  const alwaysOffered = catchAllFires(step);

  /** Every write to `goto` from this dialog — keeps the catch-all last. */
  const writeGoto = (rules: GotoRule[], always: string) => onUpdate({ goto: buildGoto(rules, always) });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={tb(d.title, { question: stepListLabel(step, bm) })}
      labelId="logic-dialog-title"
      // Two condition editors plus a rule list. At the default 448px every row
      // (field · operator · operand) wraps into an unreadable column.
      size="lg"
    >
      <div data-testid="logic-dialog" className="flex flex-col gap-4">
        <p className="text-xs text-muted-foreground">{d.subtitle}</p>

        {liveRuleCount(step) === 0 ? (
          <p data-testid="logic-dialog-empty" className="text-xs text-muted-foreground">
            {d.empty}
          </p>
        ) : null}

        <div className="flex max-h-[60vh] flex-col gap-5 overflow-y-auto">
          {/* Visibility — showWhen / hideWhen, reusing the editor that already
              knows the @score source, the per-type operators, and every guard. */}
          <section className="flex flex-col gap-2.5">
            <p className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-faint">
              <i aria-hidden className="pi pi-eye text-secondary" style={{ fontSize: 11 }} />
              {d.visibility}
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">{d.visibilityHint}</p>
            {/* The score ceiling sits WITH the rules that read it, not in a
                separate panel — it is the only thing that makes a threshold
                writable instead of guessed. */}
            <p
              data-testid="logic-dialog-score-context"
              className="rounded-md border border-border bg-muted/40 px-2.5 py-2 text-xs leading-relaxed tabular-nums text-muted-foreground"
            >
              {priorMax > 0 ? tb(d.scoreContext, { n: priorMax }) : d.scoreContextNone}
            </p>
            <LogicConditions
              step={step}
              index={index}
              steps={steps}
              scoringEnabled={scoringEnabled}
              onUpdate={onUpdate}
              m={em.logic}
            />
          </section>

          {scheduler ? (
            /* After a booking — the scheduler's forward jump. Same catch-all
               `goto` shape the settings panel writes ("any booking" → end the
               form, or jump), so both surfaces edit one rule, not two. */
            <section className="flex flex-col gap-2.5" data-testid="logic-dialog-booking">
              <p className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-faint">
                <i aria-hidden className="pi pi-calendar-plus text-secondary" style={{ fontSize: 11 }} />
                {d.booking}
              </p>
              <p className="text-xs leading-relaxed text-muted-foreground">{d.bookingHint}</p>
              <div data-testid="logic-dialog-booking-target">
                <Select
                  ariaLabel={d.booking}
                  value={afterValue}
                  options={[
                    { value: '', label: bm.settings.schedulerAfterContinue },
                    { value: AFTER_SUBMIT, label: bm.settings.schedulerAfterSubmit },
                    ...laterSteps.map((s) => ({ value: s.key, label: s.label })),
                  ]}
                  onChange={(v) => writeGoto(valueRules, v === AFTER_SUBMIT ? GOTO_END : v)}
                />
              </div>
            </section>
          ) : (
            /* Routing — value-based forward rules. */
            <section className="flex flex-col gap-2.5" data-testid="logic-dialog-routing">
              <p className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-faint">
                <i aria-hidden className="pi pi-sitemap text-secondary" style={{ fontSize: 11 }} />
                {d.routing}
              </p>
              {/* Always go to — the catch-all, edited as what it is. It is the
                  SAME control (same options, same sentinels, same write) the
                  Branching dialog puts on this question, because it is the same
                  stored rule: a round-trip through either door must leave the
                  array byte-identical. */}
              {alwaysOffered ? (
                <div className="flex items-center gap-2">
                  <span className="shrink-0 text-xs text-muted-foreground">{bm.branching.alwaysGoTo}</span>
                  {/* The testid lives on a wrapper: SelectField forwards only a
                      fixed prop set, so one handed to it would vanish. */}
                  <div data-testid="logic-dialog-always" className="w-full max-w-[340px]">
                    <SelectField
                      aria-label={bm.branching.alwaysGoTo}
                      value={alwaysValue}
                      onChange={(e) => writeGoto(valueRules, e.target.value)}
                      className="h-8 py-1 text-xs"
                    >
                      <option value={GOTO_NEXT}>{bm.branching.nextInOrder}</option>
                      {laterSteps.map((t) => (
                        <option key={t.key} value={t.key}>
                          {t.label}
                        </option>
                      ))}
                      <option value={GOTO_END}>{bm.branching.endOfForm}</option>
                    </SelectField>
                  </div>
                </div>
              ) : null}

              {routable ? (
                <>
                  <p className="text-xs leading-relaxed text-muted-foreground">{d.routingHint}</p>
                  {/* Value rules only — the catch-all is the select's business
                      above. Its writes are re-merged with the catch-all kept
                      last, the order the engine walks. */}
                  <LogicRules
                    step={{ ...step, goto: valueRules.length ? valueRules : undefined }}
                    index={index}
                    steps={steps}
                    onUpdate={(patch) => writeGoto(patch.goto ?? [], alwaysValue)}
                    m={bm}
                  />
                </>
              ) : alwaysOffered ? null : (
                /* Neither surface applies: a message card and a reveal collect
                   no answer, so they have no value to branch on AND no
                   catch-all that could ever fire. An empty rule editor here
                   would read as broken rather than as inapplicable. */
                <p data-testid="logic-dialog-no-routing" className="text-xs text-muted-foreground">
                  {d.noRouting}
                </p>
              )}
            </section>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button size="sm" data-testid="logic-dialog-close" onClick={onClose}>
            {d.done}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
