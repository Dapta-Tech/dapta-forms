'use client';

import type { FormStep } from '@quill/engine';
import { cn } from '@/lib/cn';
import { SortableList, SortableRow } from './sortable';
import { iconForStep, isContactType } from './question-types';
import { ruleCount } from './logic-util';
import type { BuilderMessages } from './builder-messages';
import { tb } from './builder-messages';

/**
 * The left flow spine — numbered question cards (drag to reorder), a type icon,
 * the truncated title, a purple "Logic" badge when the question carries rules,
 * and a muted "Contact" badge for auto-detected contact fields. The selected
 * card gets a lime left rail. One dashed "+ Add question" at the bottom opens
 * the type gallery.
 */
export function QuestionSpine({
  steps,
  selectedIndex,
  onSelect,
  onReorder,
  onAdd,
  m,
}: {
  steps: FormStep[];
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  onReorder: (from: number, to: number) => void;
  onAdd: () => void;
  m: BuilderMessages;
}) {
  const ids = steps.map((s) => s.key);

  return (
    <div className="flex h-full flex-col gap-3 border-r border-border p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">{m.shell.questions}</h2>
        <span className="text-xs text-muted-foreground">{steps.length}</span>
      </div>

      <SortableList ids={ids} onReorder={onReorder} className="flex flex-col gap-2">
        {(id, index) => {
          const step = steps[index];
          if (!step) return null;
          const active = index === selectedIndex;
          const rules = ruleCount(step);
          const contact = isContactType(step.type);
          const title = step.question?.trim();
          return (
            <SortableRow key={id} id={id}>
              {({ handleProps }) => (
                <div
                  className={cn(
                    'relative flex items-center gap-2 overflow-hidden rounded-xl border py-2.5 pl-2 pr-2.5 transition-colors',
                    active
                      ? 'border-primary bg-primary/[0.07]'
                      : 'border-border bg-card hover:border-muted-foreground/60',
                  )}
                >
                  {active ? (
                    <span aria-hidden className="absolute inset-y-1.5 left-0 w-1 rounded-full bg-primary" />
                  ) : null}
                  <button
                    type="button"
                    aria-label={m.shell.addQuestion}
                    className="shrink-0 cursor-grab touch-none rounded p-1 text-muted-foreground/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
                    {...handleProps}
                  >
                    <i aria-hidden className="pi pi-bars" style={{ fontSize: 12 }} />
                  </button>

                  <button
                    type="button"
                    onClick={() => onSelect(index)}
                    className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                  >
                    <span
                      className={cn(
                        'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[11px] font-bold tabular-nums',
                        active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
                      )}
                    >
                      {index + 1}
                    </span>
                    <i
                      aria-hidden
                      className={cn('pi shrink-0 text-muted-foreground', iconForStep(step))}
                      style={{ fontSize: 13 }}
                    />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium text-foreground">
                        {title || m.canvas.titlePlaceholder}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5">
                        {rules > 0 ? (
                          <span className="inline-flex items-center gap-1 rounded-md bg-secondary/15 px-1.5 py-0.5 text-[10px] font-semibold text-secondary">
                            <i aria-hidden className="pi pi-sitemap" style={{ fontSize: 9 }} />
                            {rules === 1 ? m.badges.ruleOne : tb(m.badges.rules, { n: rules })}
                          </span>
                        ) : contact ? (
                          <span className="inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                            {m.badges.contact}
                          </span>
                        ) : null}
                      </span>
                    </span>
                  </button>
                </div>
              )}
            </SortableRow>
          );
        }}
      </SortableList>

      <button
        type="button"
        onClick={onAdd}
        className="mt-1 flex items-center justify-center gap-2 rounded-xl border border-dashed border-border py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <i aria-hidden className="pi pi-plus" style={{ fontSize: 12 }} />
        {m.shell.addQuestion}
      </button>
    </div>
  );
}
