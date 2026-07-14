'use client';

import type { FormConfig, FormStep } from '@quill/engine';
import { cn } from '@/lib/cn';
import { iconForStep } from './question-types';
import { optionLabel } from './logic-util';
import type { BuilderMessages } from './builder-messages';
import { tb } from './builder-messages';

/**
 * The Logic Map — a truthful node graph of how answers route through the form:
 * Start → each question, with purple branch edges for forward `goto` jumps
 * ("If X → jump to Q / skip to end") and show/hide conditions, plus lime
 * end/result nodes derived from the scored outcomes. Read-to-understand; the
 * rules themselves are authored inline in Build.
 */
export function LogicMap({ config, m }: { config: FormConfig; m: BuilderMessages }) {
  const steps = config.steps;
  if (steps.length === 0) {
    return <p className="py-16 text-center text-sm text-muted-foreground">{m.map.empty}</p>;
  }

  const titleOf = (step: FormStep, i: number) => step.question?.trim() || tb(m.canvas.questionN, { n: i + 1 });
  const stepByKey = new Map(steps.map((s, i) => [s.key, i] as const));
  const outcomes = config.outcomes ?? [];

  return (
    <div className="relative">
      {/* Legend */}
      <div className="pointer-events-none sticky top-0 z-10 mb-2 flex items-center justify-end gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded border-2 border-secondary" /> {m.map.branchLegend}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded border-2 border-primary" /> {m.map.endLegend}
        </span>
      </div>

      <div className="mx-auto flex max-w-[460px] flex-col items-stretch pb-12">
        <MapNode tone="start">
          <span className="mx-auto text-sm font-semibold">{m.map.start}</span>
        </MapNode>

        {steps.map((step, i) => {
          const branches = step.goto ?? [];
          const hasCond = !!(step.showWhen || step.hideWhen);
          const isLast = i === steps.length - 1;
          return (
            <div key={step.key}>
              <Down />
              <MapNode tone={branches.length || hasCond ? 'branch' : 'default'}>
                <div className="flex items-center gap-2.5">
                  <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted text-[11px] font-bold text-muted-foreground">
                    {i + 1}
                  </span>
                  <i aria-hidden className={`pi ${iconForStep(step)} shrink-0 text-muted-foreground`} style={{ fontSize: 13 }} />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
                    {titleOf(step, i)}
                  </span>
                </div>
                {branches.length ? (
                  <p className="mt-1 pl-8 text-xs font-medium text-secondary">
                    {branches.length === 1 ? m.badges.ruleOne : tb(m.map.branches, { n: branches.length })}
                  </p>
                ) : null}
              </MapNode>

              {/* Branch edges */}
              {branches.map((rule, ri) => {
                const value = rule.values.map((v) => optionLabel(step, v)).join(', ');
                if (rule.target == null) {
                  return (
                    <BranchEdge key={ri} label={tb(m.map.skipEdge, { value })}>
                      <MapNode tone="result" compact>
                        <div className="flex items-center gap-2">
                          <i aria-hidden className="pi pi-comment text-primary" style={{ fontSize: 12 }} />
                          <span className="text-sm font-semibold text-foreground">{m.map.thankYou}</span>
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">{m.map.end}</p>
                      </MapNode>
                    </BranchEdge>
                  );
                }
                const ti = stepByKey.get(rule.target);
                const targetStep = ti != null ? steps[ti] : undefined;
                const targetLabel = ti != null && targetStep ? titleOf(targetStep, ti) : rule.target;
                return (
                  <BranchEdge key={ri} label={tb(m.map.jumpEdge, { value, target: targetLabel })}>
                    <MapNode tone="ghost" compact>
                      <div className="flex items-center gap-2">
                        <i aria-hidden className="pi pi-bolt text-secondary" style={{ fontSize: 12 }} />
                        <span className="truncate text-sm font-medium text-foreground">{targetLabel}</span>
                      </div>
                    </MapNode>
                  </BranchEdge>
                );
              })}

              {/* "Otherwise" label when this node branches but isn't the last */}
              {branches.length && !isLast ? (
                <div className="flex justify-center">
                  <span className="mt-2 inline-block rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                    {m.map.otherwise}
                  </span>
                </div>
              ) : null}
            </div>
          );
        })}

        {/* Terminal result nodes from scored outcomes */}
        {outcomes.map((o) => (
          <div key={o.id}>
            <Down />
            <MapNode tone="result">
              <div className="flex items-center gap-2.5">
                <i
                  aria-hidden
                  className={`pi ${o.redirectUrl ? 'pi-external-link' : 'pi-flag'} text-primary`}
                  style={{ fontSize: 13 }}
                />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{o.label}</span>
              </div>
              {o.redirectUrl ? (
                <p className="mt-0.5 truncate pl-6 text-xs text-muted-foreground">
                  {tb(m.map.redirect, { url: o.redirectUrl.replace(/^https?:\/\//, '') })}
                </p>
              ) : null}
            </MapNode>
          </div>
        ))}
      </div>
    </div>
  );
}

function Down() {
  return (
    <div aria-hidden className="flex justify-center py-1.5 text-muted-foreground/60">
      <i className="pi pi-arrow-down" style={{ fontSize: 12 }} />
    </div>
  );
}

function MapNode({
  children,
  tone = 'default',
  compact,
}: {
  children: React.ReactNode;
  tone?: 'default' | 'start' | 'branch' | 'result' | 'ghost';
  compact?: boolean;
}) {
  const toneClass = {
    default: 'border-border bg-card',
    start: 'border-border bg-muted',
    branch: 'border-secondary bg-secondary/[0.06]',
    result: 'border-primary bg-primary/[0.06]',
    ghost: 'border-dashed border-border bg-card',
  }[tone];
  return (
    <div className={cn('w-full rounded-xl border px-4', compact ? 'py-2.5' : 'py-3', toneClass)}>{children}</div>
  );
}

/** A branch callout: a purple labelled edge to an offset target node. */
function BranchEdge({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="ml-6 mt-2 flex items-stretch gap-2">
      <span aria-hidden className="mt-4 h-px w-6 shrink-0 self-start bg-secondary/60" />
      <div className="min-w-0 flex-1">
        <span className="mb-1 inline-block rounded-md border border-secondary/40 bg-secondary/10 px-2 py-0.5 text-[11px] font-semibold text-secondary">
          {label}
        </span>
        {children}
      </div>
    </div>
  );
}
