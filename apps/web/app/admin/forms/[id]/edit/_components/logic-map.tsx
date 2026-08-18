'use client';

import type { FormConfig, FormOutcome, FormStep } from '@quill/engine';
import { cn } from '@/lib/cn';
import { iconForStep } from './question-types';
import { conditionNeverHolds, conditionsContradict } from '@quill/engine';
import { describeCondition, liveGotoRules, optionLabel } from './logic-util';
import type { BuilderMessages, GalleryItemId } from './builder-messages';
import { tb } from './builder-messages';

/**
 * The Logic Map — a truthful, READ-ONLY node graph of how answers route through
 * the form:  Start → each question, with purple branch edges for forward `goto`
 * jumps ("If X → skip to end" / "If X → Q3") and show/hide conditions, then the
 * lime end/result nodes derived from the scored outcomes. It is a map to read,
 * not an editor — the rules themselves are authored inline in Build.
 *
 * Legibility (V4-17): distinct card styling per node role (Start capsule /
 * question card / lime ending), a numbered step badge + type icon + kind label,
 * indented & labelled branch edges with a traceable "Otherwise" path, and a
 * calm animated flow on the connectors (disabled under prefers-reduced-motion,
 * both here and by the app-wide reduce rule in globals.css).
 */

/* Scoped connector animation. The thin dashed spine segments drift downward to
   suggest flow toward the ending; kept slow + low-contrast so it reads as calm.
   Guarded for reduced motion (belt-and-suspenders with the global reduce rule). */
const MAP_STYLES = `
@keyframes lm-flow { to { background-position: 0 8px; } }
.lm-flow { animation: lm-flow 2s linear infinite; }
@media (prefers-reduced-motion: reduce) { .lm-flow { animation: none; } }
`;

export function LogicMap({ config, m }: { config: FormConfig; m: BuilderMessages }) {
  const steps = config.steps;
  if (steps.length === 0) {
    return <p className="py-16 text-center text-sm text-muted-foreground">{m.map.empty}</p>;
  }

  const titleOf = (step: FormStep, i: number) => step.question?.trim() || tb(m.canvas.questionN, { n: i + 1 });
  const stepByKey = new Map(steps.map((s, i) => [s.key, i] as const));
  const outcomes = config.outcomes ?? [];

  return (
    <div className="relative" data-testid="logic-map">
      <style dangerouslySetInnerHTML={{ __html: MAP_STYLES }} />

      {/* Legend */}
      <div className="pointer-events-none sticky top-0 z-10 mb-3 flex items-center justify-end gap-3 text-xs text-muted-foreground">
        <LegendSwatch className="bg-secondary" label={m.map.branchLegend} />
        <LegendSwatch className="bg-primary" label={m.map.endLegend} />
      </div>

      <div className="mx-auto flex max-w-[520px] flex-col items-stretch pb-12">
        {/* Start — a capsule, visually distinct from the rectangular question
            cards. The play triangle in a filled circle is gone (V5-B4): on a
            read-only map it read as a "run the form" button nobody could press.
            A plain dot marks the entry point without promising an action. */}
        <div className="flex flex-col items-center" data-testid="logic-start">
          <span className="inline-flex items-center gap-2 rounded-full border border-primary-edge/40 bg-primary/[0.08] px-4 py-2 shadow-sm">
            <span aria-hidden className="inline-block h-2 w-2 shrink-0 rounded-full bg-primary-edge" />
            <span className="text-sm font-semibold uppercase tracking-wide text-primary">{m.map.start}</span>
          </span>
          <span className="mt-1.5 text-xs text-muted-foreground">{m.map.startHint}</span>
        </div>

        {steps.map((step, i) => {
          // Only the rules that can fire — a message/reveal records no
          // answer, so a `goto` saved on one is dead config (see
          // `liveGotoRules`) and must not read as routing here either.
          const branches = liveGotoRules(step);
          const hasCond = !!(step.showWhen || step.hideWhen);
          const isLast = i === steps.length - 1;
          const hasLogic = branches.length > 0 || hasCond;
          return (
            <div key={step.key} data-testid="logic-step" data-step-key={step.key}>
              <Connector />

              {/* Question node card */}
              <div
                data-testid="logic-node"
                className={cn(
                  'relative w-full overflow-hidden rounded-xl border bg-card px-3.5 py-3 shadow-sm',
                  hasLogic ? 'border-secondary/45' : 'border-border',
                )}
              >
                {hasLogic ? (
                  <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-secondary/70" />
                ) : null}
                <div className="flex items-center gap-3">
                  <span
                    aria-hidden
                    className={cn(
                      'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums',
                      hasLogic ? 'bg-secondary/15 text-secondary' : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <i
                        aria-hidden
                        className={`pi ${iconForStep(step)} shrink-0 text-muted-foreground`}
                        style={{ fontSize: 13 }}
                      />
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
                        {titleOf(step, i)}
                      </span>
                    </div>
                    <span className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                      {kindLabel(step, m)}
                      {step.hidden ? (
                        <span
                          data-testid="logic-hidden-badge"
                          className="rounded-sm bg-muted px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-wide text-faint"
                        >
                          {m.badges.hidden}
                        </span>
                      ) : null}
                    </span>
                  </div>
                  {branches.length ? (
                    <LogicPill>
                      {branches.length === 1 ? m.badges.ruleOne : tb(m.map.branches, { n: branches.length })}
                    </LogicPill>
                  ) : null}
                </div>

                {/* The actual show/hide rules, spelled out (V5-B4). A bare
                    "Conditional" pill told you a rule existed and nothing about
                    what it said — on the one screen meant for understanding the
                    flow. */}
                {hasCond ? (
                  <div className="mt-2.5 flex flex-col gap-1.5 border-t border-border/60 pt-2.5">
                    {/* The map already renders both rules — so when they cancel
                        out, or an operand is still "(not set)", it can say the
                        step never appears. This is the view an author opens to
                        AUDIT branching; staying silent here sent them back to
                        the Build panel to discover it (V5-QA). */}
                    {conditionsContradict(step.showWhen, step.hideWhen) || conditionNeverHolds(step.showWhen) ? (
                      <p
                        data-testid="logic-never-appears"
                        className="flex items-start gap-1.5 rounded-md bg-destructive/10 px-2 py-1 text-xs font-medium leading-relaxed text-destructive"
                      >
                        <i aria-hidden className="pi pi-exclamation-triangle mt-0.5 shrink-0" style={{ fontSize: 10 }} />
                        {m.map.neverAppears}
                      </p>
                    ) : null}
                    {step.showWhen ? (
                      <ConditionLine kind="show" cond={step.showWhen} steps={steps} m={m} />
                    ) : null}
                    {step.hideWhen ? (
                      <ConditionLine kind="hide" cond={step.hideWhen} steps={steps} m={m} />
                    ) : null}
                  </div>
                ) : null}
              </div>

              {/* Branch edges — indented, labelled, traceable */}
              {branches.length ? (
                <div className="mt-2 flex flex-col gap-2">
                  {branches.map((rule, ri) => {
                    // A scheduler routes from a CATCH-ALL rule whose value is
                    // the literal `*` — it has no options to name, its answer is
                    // a booking. `optionLabel` falls back to the raw value, so
                    // this used to read "If * → Thank you".
                    const catchAll = rule.values.includes('*');
                    const value = catchAll
                      ? step.type === 'scheduler'
                        ? m.branching.anyBooking
                        : m.branching.anyAnswer
                      : rule.values.map((v) => optionLabel(step, v)).join(', ');
                    if (rule.target == null) {
                      return (
                        <BranchEdge key={ri} label={tb(m.map.skipEdge, { value })}>
                          <div
                            data-testid="logic-end"
                            className="rounded-lg border border-primary-edge/50 bg-primary/[0.07] px-3 py-2"
                          >
                            <div className="flex items-center gap-2">
                              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary/20">
                                <i aria-hidden className="pi pi-flag-fill text-primary" style={{ fontSize: 9 }} />
                              </span>
                              <span className="text-sm font-semibold text-foreground">{m.map.thankYou}</span>
                              <span className="ml-auto rounded-sm bg-primary/15 px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-wide text-primary">
                                {m.map.end}
                              </span>
                            </div>
                          </div>
                        </BranchEdge>
                      );
                    }
                    const ti = stepByKey.get(rule.target);
                    const targetStep = ti != null ? steps[ti] : undefined;
                    const targetLabel = ti != null && targetStep ? titleOf(targetStep, ti) : rule.target;
                    return (
                      <BranchEdge key={ri} label={tb(m.map.jumpEdge, { value, target: targetLabel })}>
                        <div
                          data-testid="logic-jump"
                          className="rounded-lg border border-dashed border-border bg-card px-3 py-2"
                        >
                          <div className="flex items-center gap-2">
                            {targetStep ? (
                              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-muted">
                                <i
                                  aria-hidden
                                  className={`pi ${iconForStep(targetStep)} text-secondary`}
                                  style={{ fontSize: 10 }}
                                />
                              </span>
                            ) : null}
                            {ti != null ? (
                              <span className="inline-flex h-4 shrink-0 items-center rounded-sm bg-muted px-1 text-2xs font-bold tabular-nums text-faint">
                                {ti + 1}
                              </span>
                            ) : null}
                            <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                              {targetLabel}
                            </span>
                            <i aria-hidden className="pi pi-arrow-up-right text-secondary" style={{ fontSize: 11 }} />
                          </div>
                        </div>
                      </BranchEdge>
                    );
                  })}

                  {/* The default path: if no rule matched, the flow continues in order */}
                  {!isLast ? (
                    <div className="flex justify-center pt-0.5" data-testid="logic-otherwise">
                      <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-muted/60 px-2.5 py-0.5 text-xs text-muted-foreground">
                        <i aria-hidden className="pi pi-arrow-down shrink-0" style={{ fontSize: 9 }} />
                        <span className="font-semibold text-foreground/80">{m.map.otherwise}</span>
                        <span className="truncate text-muted-foreground/80">· {m.map.otherwiseHint}</span>
                      </span>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}

        {/* Terminal result nodes from scored outcomes */}
        {outcomes.map((o) => (
          <div key={o.id}>
            <Connector />
            <OutcomeNode outcome={o} m={m} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Map a step to its gallery id so the node can show a localized kind label
 *  ("Single choice", "Email", …) reusing the existing gallery catalog. */
function galleryIdForStep(step: FormStep): GalleryItemId {
  switch (step.type) {
    case 'name':
      return 'name';
    case 'email':
      return 'email';
    case 'phone':
      return 'phone';
    case 'dropdown':
      return 'dropdown';
    case 'multiple_choice':
      return step.selectionMode === 'multiple' ? 'multiple' : 'single';
    case 'slider':
      return 'slider';
    case 'textarea':
      return 'long';
    case 'url':
      return 'url';
    case 'message':
      return 'message';
    case 'text':
    default:
      return 'short';
  }
}

/** The human, localized kind label for a step (falls back to empty). */
function kindLabel(step: FormStep, m: BuilderMessages): string {
  return m.gallery.items[galleryIdForStep(step)]?.title ?? '';
}

/** A terminal (lime) node for a scored outcome bucket. */
function OutcomeNode({ outcome, m }: { outcome: FormOutcome; m: BuilderMessages }) {
  const redirects = !!outcome.redirectUrl;
  return (
    <div
      data-testid="logic-outcome"
      className="relative w-full overflow-hidden rounded-xl border border-primary-edge/50 bg-primary/[0.06] px-3.5 py-3 shadow-sm"
    >
      <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-primary-edge" />
      <div className="flex items-center gap-3">
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/20">
          <i
            aria-hidden
            className={`pi ${redirects ? 'pi-external-link' : 'pi-flag-fill'} text-primary`}
            style={{ fontSize: 13 }}
          />
        </span>
        <div className="min-w-0 flex-1">
          <span className="block text-2xs font-semibold uppercase tracking-wide text-primary">
            {m.map.outcomeKicker}
          </span>
          <span className="block truncate text-sm font-semibold text-foreground" title={outcome.label}>
            {outcome.label}
          </span>
          {redirects ? (
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
              {tb(m.map.redirect, { url: (outcome.redirectUrl ?? '').replace(/^https?:\/\//, '') })}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * One show/hide rule as a readable sentence: `IF «Budget» is greater than 500`
 * (V5-B4). Show rules read in the branch purple, hide rules in the destructive
 * red, so the two are distinguishable at a glance instead of by reading the
 * keyword. A rule pointing at a deleted question is called out — it can never
 * hold, which silently hides the question forever.
 */
function ConditionLine({
  kind,
  cond,
  steps,
  m,
}: {
  kind: 'show' | 'hide';
  cond: NonNullable<FormStep['showWhen']>;
  steps: FormStep[];
  m: BuilderMessages;
}) {
  const d = describeCondition(cond, steps, {
    fallbackQuestion: (i) => tb(m.canvas.questionN, { n: i + 1 }),
    opIn: m.map.condIn,
    opEq: m.map.condEq,
    opGt: m.map.condGt,
    opLt: m.map.condLt,
    opBetween: m.map.condBetween,
    and: m.map.condAnd,
    blank: m.map.condBlank,
    score: m.map.condScore,
  });
  const show = kind === 'show';
  return (
    <p
      data-testid={`logic-cond-${kind}`}
      className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-xs leading-relaxed"
    >
      <span
        className={cn(
          'shrink-0 rounded-sm px-1.5 py-0.5 text-2xs font-bold uppercase tracking-wide',
          show ? 'bg-secondary/15 text-secondary' : 'bg-destructive/15 text-destructive',
        )}
      >
        {show ? m.map.condShowIf : m.map.condHideIf}
      </span>
      <span className="font-semibold text-foreground">{d.field}</span>
      <span className="text-muted-foreground">{d.operator}</span>
      <span className="font-medium text-foreground">{d.operand}</span>
      {d.dangling ? (
        <span
          data-testid="logic-cond-dangling"
          className="rounded-sm bg-destructive/15 px-1.5 py-0.5 text-2xs font-semibold text-destructive"
        >
          {m.map.condMissingField}
        </span>
      ) : null}
    </p>
  );
}

/** A legend row: a filled colour swatch + its label. */
function LegendSwatch({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span aria-hidden className={cn('inline-block h-3 w-3 rounded-sm', className)} />
      {label}
    </span>
  );
}

/** The small purple pill on a question that carries logic. */
function LogicPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-secondary/40 bg-secondary/10 px-1.5 py-0.5 text-xs font-semibold text-secondary">
      <i aria-hidden className="pi pi-directions" style={{ fontSize: 9 }} />
      {children}
    </span>
  );
}

/** The vertical connector between spine nodes: a calm downward-flowing dashed
 *  line capped with a chevron. Purely decorative. */
function Connector() {
  return (
    <div aria-hidden className="flex flex-col items-center py-1">
      <span
        className="lm-flow h-5 w-0.5"
        style={{
          backgroundImage:
            'repeating-linear-gradient(to bottom, var(--muted-foreground) 0, var(--muted-foreground) 3px, transparent 3px, transparent 8px)',
          backgroundSize: '2px 8px',
          opacity: 0.5,
        }}
      />
      <i className="pi pi-angle-down -mt-1 text-muted-foreground/70" style={{ fontSize: 12 }} />
    </div>
  );
}

/** A branch callout: a purple labelled edge elbowing off the node to an offset
 *  destination (a lime ending, or a jump-to-question chip). */
function BranchEdge({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="ml-5 flex items-stretch gap-2" data-testid="logic-branch">
      {/* Elbow: a short vertical stub up to the node, then across to the label. */}
      <span
        aria-hidden
        className="relative mt-3 h-px w-6 shrink-0 self-start bg-secondary/50 before:absolute before:-top-3 before:left-0 before:h-3 before:w-px before:bg-secondary/50"
      />
      <div className="min-w-0 flex-1">
        <span className="mb-1 inline-flex items-center gap-1 rounded-md border border-secondary/40 bg-secondary/10 px-2 py-0.5 text-xs font-semibold text-secondary">
          <i aria-hidden className="pi pi-bolt" style={{ fontSize: 9 }} />
          {label}
        </span>
        {children}
      </div>
    </div>
  );
}
