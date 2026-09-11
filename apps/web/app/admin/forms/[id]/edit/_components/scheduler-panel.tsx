'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { FormStep } from '@quill/engine';
import type { CalendlyEventType } from '@/lib/admin-api';
import { Select } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { GOTO_END, GOTO_NEXT, buildGoto } from './logic-util';
import { Switch } from '@/components/ui/switch';
import { buttonVariants } from '@/components/ui/button';
import { ProviderLogo } from '@/components/ui/provider-logo';
import { cn } from '@/lib/cn';
import { fill } from '@/lib/onboarding';
import { Field } from './fields';
import { loadCalendlyEventTypesAction } from './scheduler-actions';
import { isLinkConfigured, parseCalendlyLink } from './scheduler-link';
import type { BuilderMessages } from './builder-messages';

type FormScheduler = NonNullable<FormStep['scheduler']>;

type LoadState =
  | { status: 'loading' }
  | { status: 'disabled'; reason: string }
  | { status: 'ready'; connectedAs: string | null; eventTypes: CalendlyEventType[] };

/**
 * The scheduler step's settings: pick a Calendly event type (the account's, via
 * the connected token) and whether the embed shows event details. Connecting
 * Calendly happens once, account-wide, in Integrations — so when no token is
 * connected this prompts the author there instead of erroring (V6).
 *
 * The picker's last option is "Other event: paste its link". Calendly only
 * lists what the connected user owns or hosts, so a team round robin that user
 * is not a host of never appears — and a workspace with no connection has no
 * list at all. Pasting the event's link (or its embed snippet) stores the same
 * `url` the picker would have stored; the public form, the canvas preview and
 * the booking record all read that url and nothing else. What the link cannot
 * give is the event's custom questions, so the autofill rows stay at name +
 * email. If the pasted link IS one of the listed events, that event is picked
 * instead, so the author gets its name and questions for free.
 */
/** Sentinel for "end the form here" in the After-booking picker. */
const AFTER_SUBMIT = '__submit__';
/** Sentinel option in the event-type picker: configure by pasting a link. */
const OTHER_EVENT = '__link__';

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
  // "Paste a link" is a mode the author enters (from the picker, or from the
  // no-token prompt) and a saved link re-enters on open. The raw text is local
  // so a half-typed link never clobbers the stored url; only a valid one is
  // written through.
  const [linkMode, setLinkMode] = useState(() => isLinkConfigured(scheduler));
  const [linkText, setLinkText] = useState(() => (isLinkConfigured(scheduler) ? (scheduler.url ?? '') : ''));
  const [linkInvalid, setLinkInvalid] = useState(false);

  // Event types are account-level, so fetch once when the panel mounts.
  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    loadCalendlyEventTypesAction()
      .then((res) => {
        if (cancelled) return;
        setState(
          res.enabled
            ? { status: 'ready', connectedAs: res.connectedAs, eventTypes: res.eventTypes }
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
    state.status === 'ready'
      ? [
          ...state.eventTypes.map((e) => ({ value: e.uri, label: e.name })),
          { value: OTHER_EVENT, label: s.schedulerOtherEvent },
        ]
      : [];

  // The picked event type drives the autofill rows: Calendly always asks for a
  // name and an email, then whatever custom questions THIS event type defines.
  const selected =
    state.status === 'ready'
      ? state.eventTypes.find((e) => e.uri === scheduler.eventTypeUri)
      : undefined;
  const pickerValue = linkMode ? OTHER_EVENT : (scheduler.eventTypeUri ?? '');

  const pickEventType = (uri: string) => {
    if (uri === OTHER_EVENT) {
      // Entering link mode drops the picked event (its url would otherwise
      // keep rendering under a picker that says "other event").
      setLinkMode(true);
      setLinkText('');
      setLinkInvalid(false);
      onChange({ ...scheduler, provider: 'calendly', eventTypeUri: null, eventTypeName: null, url: null });
      return;
    }
    const et = state.status === 'ready' ? state.eventTypes.find((e) => e.uri === uri) : undefined;
    setLinkMode(false);
    setLinkInvalid(false);
    onChange({
      ...scheduler,
      provider: 'calendly',
      eventTypeUri: uri,
      eventTypeName: et?.name ?? null,
      url: et?.schedulingUrl ?? scheduler.url ?? null,
    });
  };

  const applyLink = (text: string) => {
    setLinkText(text);
    const link = parseCalendlyLink(text);
    if (!link) {
      // Empty is "not yet", not "wrong"; anything else that fails to parse is.
      setLinkInvalid(text.trim() !== '');
      return;
    }
    setLinkInvalid(false);
    // A link to an event the list already has: pick it properly, so the author
    // gets the real name and the event's custom questions.
    const listed =
      state.status === 'ready'
        ? state.eventTypes.find((e) => e.schedulingUrl.replace(/\/+$/, '') === link.url)
        : undefined;
    if (listed) {
      pickEventType(listed.uri);
      return;
    }
    onChange({
      ...scheduler,
      provider: 'calendly',
      eventTypeUri: null,
      eventTypeName: link.name,
      url: link.url,
    });
  };

  const linkField = (
    <Field label={s.schedulerLinkLabel} hint={s.schedulerLinkHint}>
      <div data-testid="scheduler-link">
        <Input
          type="url"
          inputMode="url"
          value={linkText}
          placeholder={s.schedulerLinkPlaceholder}
          aria-label={s.schedulerLinkLabel}
          aria-invalid={linkInvalid || undefined}
          onChange={(e) => applyLink(e.target.value)}
        />
        {linkInvalid ? (
          <p
            className="mt-1.5 rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive"
            data-testid="scheduler-link-invalid"
          >
            {s.schedulerLinkInvalid}
          </p>
        ) : null}
      </div>
    </Field>
  );
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
      <p className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wide text-faint">
        <ProviderLogo provider="calendly" size={13} />
        {s.schedulerSection}
      </p>
      <p className="text-xs text-muted-foreground">{s.schedulerHint}</p>

      {state.status === 'loading' ? (
        // A saved link is shown at once — it never depended on the list.
        linkMode ? linkField : <p className="text-xs text-muted-foreground">{s.schedulerLoading}</p>
      ) : state.status === 'disabled' ? (
        <>
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
          {/* No connection is not a dead end: the link works without one. */}
          {linkMode ? (
            linkField
          ) : (
            <button
              type="button"
              className="self-start text-xs font-medium text-primary underline-offset-2 hover:underline"
              data-testid="scheduler-link-instead"
              onClick={() => pickEventType(OTHER_EVENT)}
            >
              {s.schedulerLinkInstead}
            </button>
          )}
        </>
      ) : (
        <>
          <Field label={s.schedulerEventType}>
            <div data-testid="scheduler-event-select">
              <Select
                ariaLabel={s.schedulerEventType}
                value={pickerValue}
                placeholder={s.schedulerPickPlaceholder}
                options={options}
                searchable
                onChange={pickEventType}
              />
            </div>
            {/* Whose list this is. Calendly scopes event types to the token's
                user, so a team round robin that user does not host is simply
                absent — say so here, where the author is looking for it. */}
            {state.connectedAs ? (
              <p className="mt-1.5 text-xs text-muted-foreground" data-testid="scheduler-scoped-to">
                {fill(s.schedulerScopedTo, { email: state.connectedAs })}
              </p>
            ) : null}
          </Field>
          {linkMode ? linkField : null}
        </>
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
          {selected
            ? s.schedulerMapHint
            : isLinkConfigured(scheduler)
              ? s.schedulerMapLinkHint
              : s.schedulerMapPickFirst}
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
