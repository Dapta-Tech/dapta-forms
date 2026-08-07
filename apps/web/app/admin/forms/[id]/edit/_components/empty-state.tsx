'use client';

import type { BuilderMessages } from './builder-messages';
import { TEMPLATE_ORDER, TEMPLATE_ICON } from './templates';
import type { TemplateId } from './builder-messages';

/**
 * The guided empty state (new form / zero questions). The flow reads
 * start-from-scratch-or-pick-a-template: a blank-canvas option comes first as a
 * clear primary choice, then four ready-made template cards. Picking a template
 * loads a ready config (the form keeps the name the user already gave it —
 * applyTemplate only swaps `config`); scratch opens the type gallery.
 *
 * Only the emphasized (recommended) template carries the lime accent; every
 * other card stays neutral/grey. Cards are real <button>s (implicit role=button)
 * with an explicit pointer cursor + hover affordance (Tailwind v4 drops the
 * default button pointer cursor).
 */
export function EmptyState({
  onPickTemplate,
  onScratch,
  m,
}: {
  onPickTemplate: (id: TemplateId) => void;
  onScratch: () => void;
  m: BuilderMessages;
}) {
  return (
    <div className="mx-auto flex max-w-[1040px] flex-col items-center px-4 pb-16 pt-[8vh] text-center">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{m.empty.title}</h1>
      <p className="mt-3 max-w-xl text-sm text-muted-foreground sm:text-base">{m.empty.subtitle}</p>

      {/* Start from scratch — the clear first option. */}
      <button
        type="button"
        onClick={onScratch}
        data-testid="empty-scratch"
        className="group mt-10 flex w-full max-w-xl cursor-pointer items-center gap-4 rounded-xl border border-border bg-card p-5 text-left transition-colors hover:border-primary/60 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground transition-colors group-hover:text-foreground">
          <i aria-hidden className="pi pi-plus" style={{ fontSize: 18 }} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-base font-semibold text-foreground">{m.empty.scratchTitle}</span>
          <span className="mt-0.5 block text-sm text-muted-foreground">{m.empty.scratchDesc}</span>
        </span>
        <i
          aria-hidden
          className="pi pi-arrow-right shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
          style={{ fontSize: 13 }}
        />
      </button>

      {/* Or choose a template. */}
      <div className="mt-10 flex w-full items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {m.empty.templatesLabel}
        </span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <div className="mt-6 grid w-full gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {TEMPLATE_ORDER.map((id) => {
          const t = m.empty.templates[id];
          // Only the recommended template is emphasized (lime); the rest stay grey.
          const emphasized = id === 'lead';
          const metaParts = t.meta.split(' · ');
          return (
            <button
              key={id}
              type="button"
              onClick={() => onPickTemplate(id)}
              data-testid={`empty-template-${id}`}
              className="group flex cursor-pointer flex-col rounded-xl border border-border bg-card p-5 text-left transition-colors hover:border-primary/60 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span
                className={
                  'inline-flex h-11 w-11 items-center justify-center rounded-xl transition-colors ' +
                  (emphasized
                    ? 'bg-primary/15 text-primary'
                    : 'bg-muted text-muted-foreground group-hover:text-foreground')
                }
              >
                <i aria-hidden className={`pi ${TEMPLATE_ICON[id]}`} style={{ fontSize: 18 }} />
              </span>
              <span className="mt-4 text-base font-semibold text-foreground">{t.name}</span>
              <span className="mt-1.5 flex-1 text-sm leading-relaxed text-muted-foreground">{t.desc}</span>
              <span className="mt-4 text-xs text-muted-foreground">
                {/* Neutral on every card — lime is reserved for the emphasized icon only. */}
                <span className="font-semibold text-foreground">{metaParts[0]}</span>
                {metaParts.length > 1 ? ` · ${metaParts.slice(1).join(' · ')}` : ''}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
