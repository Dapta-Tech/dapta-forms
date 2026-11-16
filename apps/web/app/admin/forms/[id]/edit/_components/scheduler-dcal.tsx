'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormStep } from '@quill/engine';
import type { DcalEventType, DcalEventTypesResponse, DcalWorkspace } from '@/lib/admin-api';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Field } from './fields';
import type { BuilderMessages } from './builder-messages';

type FormScheduler = NonNullable<FormStep['scheduler']>;
type Msgs = BuilderMessages['settings'];

/**
 * The dCal half of the scheduler step: pick one of the author's own event
 * types, in any workspace they can reach.
 *
 * There is no connect step and no token field, which is the whole difference
 * from the Calendly panel beside it: dCal projects the same identity service
 * this app does, so the author's session is the credential and the list is
 * simply what they can already see in dCal.
 *
 * Which makes the EMPTY state the interesting one. An author who has never
 * made an event type is not misconfigured, they just have nothing to pick yet,
 * and the two things they might do about it are both offered here: switch to
 * another workspace (only when they actually have one), or create an event in
 * dCal, which opens in a new tab so the half-built form is not navigated away
 * from. They come back to a refresh that re-reads the list past the server's
 * five-minute cache, because without that they would create an event, press
 * refresh, see the same empty list and conclude this is broken.
 */

type LoadState =
  | { status: 'loading' }
  | { status: 'unavailable'; reason: string }
  | { status: 'error' }
  | {
      status: 'ready';
      connectedAs: string | null;
      workspaces: DcalWorkspace[];
      eventTypes: DcalEventType[];
      createEventUrl: string | null;
    };

/**
 * The list over a plain same-origin GET, for the same reason the Calendly one
 * is: a server action dispatched from a mount effect is lost on the path where
 * the step was just added from the gallery, and a read has no business
 * queueing behind autosaves.
 */
async function fetchDcalEventTypes(
  workspaceId: string | null,
  refresh: boolean,
): Promise<DcalEventTypesResponse> {
  const query = new URLSearchParams();
  if (workspaceId) query.set('workspaceId', workspaceId);
  if (refresh) query.set('refresh', '1');
  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  const res = await fetch(`/admin/integrations/dcal/event-types${suffix}`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`dcal event types: HTTP ${res.status}`);
  return (await res.json()) as DcalEventTypesResponse;
}

export function SchedulerDcalPicker({
  scheduler,
  onChange,
  fields,
  s,
}: {
  scheduler: FormScheduler;
  onChange: (next: FormScheduler) => void;
  /** Answers captured BEFORE this step: the only ones that can prefill it. */
  fields: { key: string; label: string }[];
  s: Msgs;
}) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  /** Null = the author's home workspace, whichever dCal resolves that to. */
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  /** Which read is the newest, so a slow one cannot land on top of it. */
  const requestRef = useRef(0);

  const load = useCallback(
    async (id: string | null, refresh: boolean) => {
      const token = ++requestRef.current;
      if (refresh) setRefreshing(true);
      else setState({ status: 'loading' });
      try {
        const res = await fetchDcalEventTypes(id, refresh);
        if (requestRef.current !== token) return; // a newer read already landed
        setState(
          res.enabled
            ? {
                status: 'ready',
                connectedAs: res.connectedAs,
                workspaces: res.workspaces,
                eventTypes: res.eventTypes,
                createEventUrl: res.createEventUrl,
              }
            : { status: 'unavailable', reason: res.reason },
        );
      } catch {
        if (requestRef.current === token) setState({ status: 'error' });
      } finally {
        if (requestRef.current === token) setRefreshing(false);
      }
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (cancelled) return;
      await load(workspaceId, false);
    })();
    return () => {
      cancelled = true;
    };
  }, [load, workspaceId]);

  if (state.status === 'loading') {
    return <p className="text-xs text-muted-foreground">{s.schedulerLoading}</p>;
  }
  if (state.status === 'unavailable') {
    return <p className="text-xs text-muted-foreground">{s.schedulerDcalUnavailable}</p>;
  }
  if (state.status === 'error') {
    return (
      <div className="flex items-center gap-2">
        <p className="text-xs text-destructive">{s.schedulerListError}</p>
        <Button type="button" size="sm" variant="outline" onClick={() => void load(workspaceId, false)}>
          {s.schedulerRetry}
        </Button>
      </div>
    );
  }

  const { workspaces, eventTypes, createEventUrl, connectedAs } = state;
  // Only a real choice is a choice: one workspace needs no switcher, and the
  // empty state must not offer to switch to the workspace they are already in.
  const canSwitch = workspaces.length > 1;

  /** The picked event, which is what defines the fields there are to map. */
  const selected = eventTypes.find((e) => e.id === scheduler.eventTypeUri);
  /**
   * The rows of the autofill table: the three fields dCal's booking form always
   * asks by itself, then whatever THIS event type adds. `notes` is here and is
   * not in the Calendly panel, because Calendly's form has no notes field.
   */
  const mapRows: { name: string; label: string }[] = [
    { name: 'name', label: s.schedulerMapName },
    { name: 'email', label: s.schedulerMapEmail },
    { name: 'notes', label: s.schedulerMapNotes },
    ...(selected?.bookingFields ?? []).map((f) => ({ name: f.name, label: f.label || f.name })),
  ];

  const pick = (id: string) => {
    const et = eventTypes.find((e) => e.id === id);
    onChange({
      ...scheduler,
      provider: 'dcal',
      eventTypeUri: id,
      eventTypeName: et?.name ?? null,
      url: et?.schedulingUrl ?? null,
      // The mapping is keyed by the PROVIDER's field ids, so a map written for
      // another event type (or for Calendly's positional ids) means nothing
      // here and would silently prefill the wrong question.
      prefillMap: {},
    });
  };

  const label = (e: DcalEventType) =>
    e.teamName
      ? `${e.name} · ${s.schedulerDcalTeam.replace('{team}', e.teamName)}`
      : e.name;

  return (
    <div className="flex flex-col gap-3">
      {canSwitch ? (
        <Field label={s.schedulerDcalWorkspace}>
          <div data-testid="scheduler-dcal-workspace">
            <Select
              ariaLabel={s.schedulerDcalWorkspace}
              // The author's own pick wins. `current` is only the starting
            // point: dCal may report the home workspace as current whatever
            // was asked for, which showed one name over another's events.
            value={workspaceId ?? workspaces.find((w) => w.current)?.id ?? ''}
              onChange={(v) => setWorkspaceId(v || null)}
              options={workspaces.map((w) => ({ value: w.id, label: w.name }))}
            />
          </div>
        </Field>
      ) : null}

      {eventTypes.length > 0 ? (
        <Field label={s.schedulerEventType}>
          <div data-testid="scheduler-dcal-event-type">
            <Select
              ariaLabel={s.schedulerEventType}
              value={scheduler.eventTypeUri ?? ''}
              onChange={(v) => pick(v)}
              placeholder={s.schedulerPickPlaceholder}
              options={eventTypes.map((e) => ({ value: e.id, label: label(e) }))}
            />
          </div>
        </Field>
      ) : (
        <div
          data-testid="scheduler-dcal-empty"
          className="flex flex-col gap-2 rounded-md border border-dashed border-border bg-muted/40 p-3"
        >
          <p className="text-xs text-foreground">{s.schedulerDcalEmpty}</p>
          {canSwitch ? (
            <p className="text-xs text-muted-foreground">{s.schedulerDcalEmptySwitch}</p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            {createEventUrl ? (
              <a
                data-testid="scheduler-dcal-create"
                href={createEventUrl}
                // A new tab on purpose: the form being edited is half-built,
                // and navigating away from the builder to go make a calendar
                // event is how an author loses their place.
                target="_blank"
                rel="noreferrer noopener"
                className="text-xs font-medium underline"
              >
                {s.schedulerDcalCreate}
              </a>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid="scheduler-dcal-refresh"
              disabled={refreshing}
              // `refresh` is what makes this button honest: the server caches
              // the list for five minutes, which is exactly the window an
              // author who just created an event would be pressing it in.
              onClick={() => void load(workspaceId, true)}
            >
              {refreshing ? s.schedulerDcalRefreshing : s.schedulerDcalRefresh}
            </Button>
          </div>
        </div>
      )}

      {connectedAs ? (
        <p className="text-xs text-muted-foreground">
          {s.schedulerDcalScopedTo.replace('{email}', connectedAs)}
        </p>
      ) : null}

      {/* Autofill: which earlier answer feeds each field THIS event's booking
          form asks for. Keyed by the field's NAME, which is what dCal prefills
          by, so reordering the host's questions cannot aim a value at the
          wrong one. Only rendered once an event is picked, because until then
          there are no fields to map: the three built-ins are the same on every
          event, but a mapping saved against no event would be a mapping the
          author cannot see the other half of. */}
      {selected ? (
        <div className="flex flex-col gap-2 border-t border-border pt-3" data-testid="scheduler-dcal-map">
          <p className="text-xs font-medium text-foreground">{s.schedulerMapTitle}</p>
          <p className="text-xs text-muted-foreground">{s.schedulerMapHint}</p>
          {mapRows.map((row) => (
            <Field key={row.name} label={row.label}>
              <div data-testid={`scheduler-dcal-map-${row.name}`}>
                <Select
                  ariaLabel={row.label}
                  value={scheduler.prefillMap?.[row.name] ?? ''}
                  options={[
                    { value: '', label: s.schedulerMapAuto },
                    ...fields.map((f) => ({ value: f.key, label: f.label })),
                  ]}
                  onChange={(key) =>
                    onChange({
                      ...scheduler,
                      prefillMap: { ...scheduler.prefillMap, [row.name]: key || null },
                    })
                  }
                />
              </div>
            </Field>
          ))}
        </div>
      ) : null}
    </div>
  );
}
