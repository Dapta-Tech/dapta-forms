'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { FormStep } from '@quill/engine';
import type { CalendlyEventType } from '@/lib/admin-api';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { Field } from './fields';
import { loadCalendlyEventTypesAction } from './scheduler-actions';
import type { BuilderMessages } from './builder-messages';

type FormScheduler = NonNullable<FormStep['scheduler']>;

type LoadState =
  | { status: 'loading' }
  | { status: 'disabled'; reason: string }
  | { status: 'ready'; eventTypes: CalendlyEventType[] };

/**
 * The scheduler step's settings: pick a Calendly event type (the account's, via
 * the connected token) and whether the embed shows event details. Connecting
 * Calendly happens once, account-wide, in Integrations — so when no token is
 * connected this prompts the author there instead of erroring (V6).
 */
export function SchedulerPanel({
  scheduler,
  onChange,
  bm,
}: {
  scheduler: FormScheduler;
  onChange: (next: FormScheduler) => void;
  bm: BuilderMessages;
}) {
  const s = bm.settings;
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  // Event types are account-level, so fetch once when the panel mounts.
  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    loadCalendlyEventTypesAction()
      .then((res) => {
        if (cancelled) return;
        setState(
          res.enabled
            ? { status: 'ready', eventTypes: res.eventTypes }
            : { status: 'disabled', reason: res.reason },
        );
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'disabled', reason: s.schedulerConnect });
      });
    return () => {
      cancelled = true;
    };
    // s is a stable catalog subtree — intentionally not a dependency (fetch once).
  }, [s.schedulerConnect]);

  const options =
    state.status === 'ready' ? state.eventTypes.map((e) => ({ value: e.uri, label: e.name })) : [];

  return (
    <section className="flex flex-col gap-3 border-t border-border pt-4" data-testid="scheduler-panel">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {s.schedulerSection}
      </p>
      <p className="text-xs text-muted-foreground">{s.schedulerHint}</p>

      {state.status === 'loading' ? (
        <p className="text-xs text-muted-foreground">{s.schedulerLoading}</p>
      ) : state.status === 'disabled' ? (
        <div
          className="flex flex-col items-start gap-2 rounded-md border border-dashed border-border bg-muted/40 p-3"
          data-testid="scheduler-connect-prompt"
        >
          <p className="text-xs text-muted-foreground">{s.schedulerConnect}</p>
          <Link
            href="/admin/integrations"
            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
          >
            {s.schedulerConnectCta}
          </Link>
        </div>
      ) : (
        <Field label={s.schedulerEventType}>
          <div data-testid="scheduler-event-select">
            <Select
              ariaLabel={s.schedulerEventType}
              value={scheduler.eventTypeUri ?? ''}
              placeholder={s.schedulerPickPlaceholder}
              options={options}
              searchable
              onChange={(uri) => {
                const et = state.eventTypes.find((e) => e.uri === uri);
                onChange({
                  ...scheduler,
                  provider: 'calendly',
                  eventTypeUri: uri,
                  url: et?.schedulingUrl ?? scheduler.url ?? null,
                });
              }}
            />
          </div>
        </Field>
      )}

      <div className="flex items-center justify-between gap-4">
        <label className="text-sm font-medium">{s.schedulerShowDetails}</label>
        <Switch
          checked={!scheduler.hideEventDetails}
          onCheckedChange={(show) => onChange({ ...scheduler, hideEventDetails: !show })}
          aria-label={s.schedulerShowDetails}
        />
      </div>
    </section>
  );
}
