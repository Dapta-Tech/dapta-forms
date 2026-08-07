'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { FormStep } from '@quill/engine';
import type { CalendlyEventType } from '@/lib/admin-api';
import { Select } from '@/components/ui/select';
import { GOTO_END, GOTO_NEXT, buildGoto } from './logic-util';
import { Switch } from '@/components/ui/switch';
import { buttonVariants } from '@/components/ui/button';
import { ProviderLogo } from '@/components/ui/provider-logo';
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
/** Sentinel for "end the form here" in the After-booking picker. */
const AFTER_SUBMIT = '__submit__';

export function SchedulerPanel({
  scheduler,
  onChange,
  fields,
  laterSteps,
  goto,
  onGotoChange,
  bm,
}: {
  scheduler: FormScheduler;
  onChange: (next: FormScheduler) => void;
  /** Answer fields captured BEFORE this step — the only ones that can prefill. */
  fields: { key: string; label: string }[];
  /** Steps AFTER this one — the only legal forward jump targets. */
  laterSteps: { key: string; label: string }[];
  goto: FormStep['goto'];
  onGotoChange: (next: FormStep['goto']) => void;
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

  // The picked event type drives the autofill rows: Calendly always asks for a
  // name and an email, then whatever custom questions THIS event type defines.
  const selected =
    state.status === 'ready'
      ? state.eventTypes.find((e) => e.uri === scheduler.eventTypeUri)
      : undefined;
  // The catch-all rule this panel owns, mapped back onto the picker.
  const catchAll = goto?.find((r) => r.values.includes('*'));
  const afterValue = !catchAll ? '' : (catchAll.target ?? AFTER_SUBMIT);

  const bookingFields: { id: string; label: string }[] = [
    { id: 'name', label: s.schedulerMapName },
    { id: 'email', label: s.schedulerMapEmail },
    ...(selected?.customQuestions ?? []).map((q) => ({ id: q.id, label: q.label })),
  ];

  return (
    <section className="flex flex-col gap-3 border-t border-border pt-4" data-testid="scheduler-panel">
      {/* The mark, not a generic calendar glyph: this section books through
          Calendly specifically, and every other surface that says so now shows
          the same logo. */}
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <ProviderLogo provider="calendly" size={13} />
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
                  eventTypeName: et?.name ?? null,
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

      {/* Where the form goes once they book. A scheduler's answer is a
          timestamp, so there is no option value to branch on — this writes a
          catch-all rule ("any booking") that either ends the form or jumps. */}
      <div className="flex flex-col gap-1.5 border-t border-border pt-3">
        <p className="text-xs font-medium text-foreground">{s.schedulerAfter}</p>
        <p className="text-xs text-muted-foreground">{s.schedulerAfterHint}</p>
        <div data-testid="scheduler-after">
          <Select
            ariaLabel={s.schedulerAfter}
            value={afterValue}
            options={[
              { value: '', label: s.schedulerAfterContinue },
              { value: AFTER_SUBMIT, label: s.schedulerAfterSubmit },
              ...laterSteps.map((st) => ({ value: st.key, label: st.label })),
            ]}
            onChange={(v) => {
              // Through the shared builder, not a whole-array replacement:
              // this picker owns the catch-all ONLY, and a scheduler can carry
              // value rules too (a jump authored in Branching). Replacing the
              // array here used to drop them.
              const valueRules = (goto ?? []).filter((r) => !r.values.includes('*'));
              onGotoChange(buildGoto(valueRules, !v ? GOTO_NEXT : v === AFTER_SUBMIT ? GOTO_END : v));
            }}
          />
        </div>
      </div>

      {/* Autofill: which earlier answer feeds each field THIS event type's
          booking page asks for. The two built-ins are always there; everything
          after them comes from the event type's own custom questions, so a
          phone field is filled by the id Calendly actually gave it. */}
      <div className="flex flex-col gap-2 border-t border-border pt-3" data-testid="scheduler-map">
        <p className="text-xs font-medium text-foreground">{s.schedulerMapTitle}</p>
        <p className="text-xs text-muted-foreground">
          {selected ? s.schedulerMapHint : s.schedulerMapPickFirst}
        </p>
        {bookingFields.map((bf) => (
          <Field key={bf.id} label={bf.label}>
            <div data-testid={`scheduler-map-${bf.id}`}>
              <Select
                ariaLabel={bf.label}
                value={scheduler.prefillMap?.[bf.id] ?? ''}
                options={[
                  { value: '', label: s.schedulerMapAuto },
                  ...fields.map((f) => ({ value: f.key, label: f.label })),
                ]}
                onChange={(key) =>
                  onChange({
                    ...scheduler,
                    prefillMap: { ...scheduler.prefillMap, [bf.id]: key || null },
                  })
                }
              />
            </div>
          </Field>
        ))}
      </div>
    </section>
  );
}
