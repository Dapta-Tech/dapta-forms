'use client';

import type { BuilderMessages } from './builder-messages';
import { TEMPLATE_ORDER, TEMPLATE_ICON } from './templates';
import type { TemplateId } from './builder-messages';

/**
 * The guided empty state (new form / zero questions): four template cards +
 * "start from scratch". Replaces the old type-dropdown cold start — the user
 * begins from a decision, not a schema word. Picking a template loads a ready
 * config; scratch opens the type gallery.
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

      <div className="mt-10 grid w-full gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {TEMPLATE_ORDER.map((id) => {
          const t = m.empty.templates[id];
          const first = id === 'lead';
          return (
            <button
              key={id}
              type="button"
              onClick={() => onPickTemplate(id)}
              className="group flex flex-col rounded-2xl border border-border bg-card p-5 text-left transition-colors hover:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span
                className={
                  'inline-flex h-11 w-11 items-center justify-center rounded-xl transition-colors ' +
                  (first
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground group-hover:text-foreground')
                }
              >
                <i aria-hidden className={`pi ${TEMPLATE_ICON[id]}`} style={{ fontSize: 18 }} />
              </span>
              <span className="mt-4 text-base font-semibold text-foreground">{t.name}</span>
              <span className="mt-1.5 flex-1 text-sm leading-relaxed text-muted-foreground">{t.desc}</span>
              <span className="mt-4 text-xs text-muted-foreground">
                <span className="font-semibold text-primary">{t.meta.split(' · ')[0]}</span>
                {t.meta.includes(' · ') ? ` · ${t.meta.split(' · ').slice(1).join(' · ')}` : ''}
              </span>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={onScratch}
        className="mt-8 inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md px-2 py-1"
      >
        <i aria-hidden className="pi pi-plus" style={{ fontSize: 12 }} />
        {m.empty.scratch}
      </button>
    </div>
  );
}
