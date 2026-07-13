'use client';

import type { FormConfig, FormFieldType } from '@quill/engine';
import type { EditorMessages } from './messages';

const TYPE_TAG: Record<FormFieldType, string> = {
  text: 'TXT',
  name: 'NAME',
  email: 'MAIL',
  phone: 'TEL',
  dropdown: 'LIST',
  multiple_choice: 'PICK',
  slider: 'SLDR',
  textarea: 'LONG',
  message: 'MSG',
};

function Arrow() {
  return (
    <div aria-hidden className="flex justify-center py-1 text-muted-foreground">
      <i className="pi pi-arrow-down" style={{ fontSize: 12 }} />
    </div>
  );
}

function Node({
  children,
  tone = 'default',
}: {
  children: React.ReactNode;
  tone?: 'default' | 'accent' | 'muted';
}) {
  const toneClass =
    tone === 'accent'
      ? 'border-primary bg-primary/10'
      : tone === 'muted'
        ? 'border-dashed border-border bg-card'
        : 'border-border bg-card';
  return (
    <div className={`mx-auto w-full max-w-md rounded-lg border px-4 py-3 ${toneClass}`}>{children}</div>
  );
}

/**
 * A clean, read-only map of the whole form: cover → each step (with its type,
 * question, flow group and any conditional-visibility summary) → end. No
 * editing on the diagram (Track A brief §6) — it's an at-a-glance overview.
 */
export function FlowDiagram({ config, m }: { config: FormConfig; m: EditorMessages }) {
  const coverOn = config.cover?.enabled !== false && config.cover != null;

  if (config.steps.length === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">{m.flow.empty}</p>;
  }

  const fieldLabel = (key: string): string => {
    const s = config.steps.find((x) => x.key === key);
    return s?.question?.trim() || key;
  };

  return (
    <div className="mx-auto max-w-[640px]">
      {coverOn ? (
        <>
          <Node tone="accent">
            <div className="flex items-center gap-2">
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-muted-foreground">
                {m.flow.cover.toUpperCase()}
              </span>
              <span className="truncate text-sm font-medium">
                {config.cover?.headline || m.flow.cover}
              </span>
            </div>
          </Node>
          <Arrow />
        </>
      ) : null}

      {config.steps.map((step, i) => {
        const conditions: string[] = [];
        if (step.showWhen) conditions.push(`${m.logic.showWhen}: ${fieldLabel(step.showWhen.field)} = ${step.showWhen.values.join(', ')}`);
        if (step.hideWhen) conditions.push(`${m.logic.hideWhen}: ${fieldLabel(step.hideWhen.field)} = ${step.hideWhen.values.join(', ')}`);
        return (
          <div key={step.key}>
            <Node tone={conditions.length ? 'muted' : 'default'}>
              <div className="flex items-center gap-2">
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-muted-foreground">
                  {TYPE_TAG[step.type]}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {step.question?.trim() || m.steps.untitled}
                </span>
                {step.flowGroup === 'lead_capture' ? (
                  <span className="shrink-0 rounded-full bg-secondary/20 px-2 py-0.5 text-[10px] font-semibold text-secondary">
                    {m.props.leadCapture}
                  </span>
                ) : null}
              </div>
              {conditions.length ? (
                <ul className="mt-1.5 flex flex-col gap-0.5 border-t border-border pt-1.5">
                  {conditions.map((c, ci) => (
                    <li key={ci} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <i aria-hidden className="pi pi-sitemap" style={{ fontSize: 10 }} />
                      {c}
                    </li>
                  ))}
                </ul>
              ) : null}
            </Node>
            <Arrow />
            {i === config.steps.length - 1 ? (
              <Node tone="muted">
                <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                  <i aria-hidden className="pi pi-flag" style={{ fontSize: 12 }} />
                  {m.flow.end}
                </div>
              </Node>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
