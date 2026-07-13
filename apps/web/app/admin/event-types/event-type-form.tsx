'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { BookingMessages } from '@slate/shared';
import type { EventType } from '@/lib/admin-api';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { FormHeader } from '@/components/ui/page-header';
import { saveEventTypeAction, type ActionResult, type EventTypePayload } from './actions';

type EventTypeMessages = BookingMessages['admin']['eventTypes'];

const FIELD_TYPES = ['text', 'textarea', 'email', 'phone', 'number', 'select', 'checkbox', 'guests'];
const SCHEDULING_METHODS = ['round_robin', 'collective', 'fixed_round_robin'] as const;
type SchedulingMethod = (typeof SCHEDULING_METHODS)[number];

interface IntakeField {
  name: string;
  label: string;
  type: string;
  required: boolean;
}

interface HostRow {
  memberId: string;
  priority: number | null;
  weight: number | null;
  isFixed: boolean;
}

export interface TeamMemberOption {
  memberId: string;
  displayName: string | null;
}

export function EventTypeForm({
  initial,
  schedules = [],
  messages: m,
  scheduling,
  teamMembers,
  redirectOnSuccess,
  backHref,
  backLabel,
  heading,
}: {
  initial?: EventType;
  schedules?: Array<{ id: string; name: string }>;
  messages: EventTypeMessages;
  /** Scheduling-method names + hints (from the shared `scheduling` catalog). */
  scheduling?: BookingMessages['scheduling'];
  /** The team's members — present only when editing a TEAM event type. */
  teamMembers?: TeamMemberOption[];
  /** When set (the dedicated /new surface), navigate here after a create. */
  redirectOnSuccess?: string;
  /** FormHeader nav + title (the admin screen header system). */
  backHref: string;
  backLabel: string;
  heading: string;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initial?.title ?? '');
  const [slug, setSlug] = useState(initial?.slug ?? '');
  const [slugTouched, setSlugTouched] = useState(!!initial);
  const [description, setDescription] = useState(initial?.description ?? '');
  const [location, setLocation] = useState(initial?.location ?? '');
  const [lengthMinutes, setLength] = useState(initial?.lengthMinutes ?? 30);
  const [minNotice, setMinNotice] = useState(120);
  const [slotInterval, setSlotInterval] = useState<number | ''>(initial?.lengthMinutes ?? 30);
  const [beforeBuf, setBeforeBuf] = useState(0);
  const [afterBuf, setAfterBuf] = useState(0);
  const [seats, setSeats] = useState<number | ''>(initial?.seatsPerTimeSlot ?? '');
  const [scheduleId, setScheduleId] = useState<string>(initial?.scheduleId ?? '');
  const [requiresConfirmation, setRequiresConf] = useState(initial?.requiresConfirmation ?? false);
  const [hidden, setHidden] = useState(initial?.hidden ?? false);
  const [fields, setFields] = useState<IntakeField[]>(
    (initial?.bookingFields as IntakeField[] | undefined)?.map((f) => ({
      name: f.name,
      label: f.label,
      type: f.type,
      required: !!f.required,
    })) ?? [],
  );
  const isTeamEvent = !!initial?.teamId && !!teamMembers && !!scheduling;
  const [schedulingType, setSchedulingType] = useState<SchedulingMethod>(
    (SCHEDULING_METHODS as readonly string[]).includes(initial?.schedulingType ?? '')
      ? (initial!.schedulingType as SchedulingMethod)
      : 'round_robin',
  );
  const [hosts, setHosts] = useState<HostRow[]>(
    (teamMembers ?? []).map((tm) => {
      const existing = initial?.hosts?.find((h) => h.memberId === tm.memberId);
      return {
        memberId: tm.memberId,
        priority: existing?.priority ?? 0,
        weight: existing?.weight ?? 100,
        isFixed: existing?.isFixed ?? false,
      };
    }),
  );
  const setHost = (memberId: string, patch: Partial<HostRow>) =>
    setHosts((hs) => hs.map((h) => (h.memberId === memberId ? { ...h, ...patch } : h)));

  const [res, setRes] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();

  const onTitle = (v: string) => {
    setTitle(v);
    if (!slugTouched) setSlug(v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''));
  };

  const save = () =>
    start(async () => {
      const payload: EventTypePayload = {
        id: initial?.id,
        title,
        slug,
        description: description.trim() || null,
        location: location.trim() || null,
        lengthMinutes: Number(lengthMinutes),
        minimumBookingNotice: Number(minNotice),
        slotInterval: slotInterval === '' ? null : Number(slotInterval),
        beforeEventBuffer: Number(beforeBuf),
        afterEventBuffer: Number(afterBuf),
        seatsPerTimeSlot: seats === '' ? null : Number(seats),
        scheduleId: scheduleId || null,
        requiresConfirmation,
        hidden,
        bookingFields: fields.filter((f) => f.name && f.label),
        ...(isTeamEvent
          ? {
              schedulingType,
              hosts: hosts.map((h) => ({
                memberId: h.memberId,
                priority: h.priority,
                weight: h.weight,
                isFixed: schedulingType === 'fixed_round_robin' ? h.isFixed : false,
              })),
            }
          : {}),
      };
      const r = await saveEventTypeAction(payload);
      setRes(r);
      // Create on a dedicated /new surface → return to the list on success.
      if (r.ok && !initial && redirectOnSuccess) router.push(redirectOnSuccess);
    });

  return (
    <form onSubmit={(e) => { e.preventDefault(); save(); }}>
      <FormHeader
        backHref={backHref}
        backLabel={backLabel}
        title={heading}
        actions={
          <Button type="submit" disabled={pending || !title || !slug}>
            {pending ? m.saving : initial ? m.saveChanges : m.createEventType}
          </Button>
        }
      />
      <div className="flex flex-col gap-4 rounded-md border border-border bg-card p-5">
      <div className="grid grid-cols-2 gap-3">
        <Field label={m.fTitle}>
          <input value={title} onChange={(e) => onTitle(e.target.value)} className={inputCls} />
        </Field>
        <Field label={m.fSlug}>
          <input value={slug} onChange={(e) => { setSlug(e.target.value); setSlugTouched(true); }} className={inputCls} />
        </Field>
      </div>
      <Field label={m.fDescription}>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={inputCls} />
      </Field>
      <Field label={m.fLocation}>
        <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder={m.locationPlaceholder} className={inputCls} />
      </Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label={m.fLength}>
          <input type="number" value={lengthMinutes} onChange={(e) => setLength(Number(e.target.value))} className={inputCls} />
        </Field>
        <Field label={m.fSlotInterval}>
          <input type="number" value={slotInterval} onChange={(e) => setSlotInterval(e.target.value === '' ? '' : Number(e.target.value))} className={inputCls} />
        </Field>
        <Field label={m.fMinNotice}>
          <input type="number" value={minNotice} onChange={(e) => setMinNotice(Number(e.target.value))} className={inputCls} />
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label={m.fBufferBefore}>
          <input type="number" value={beforeBuf} onChange={(e) => setBeforeBuf(Number(e.target.value))} className={inputCls} />
        </Field>
        <Field label={m.fBufferAfter}>
          <input type="number" value={afterBuf} onChange={(e) => setAfterBuf(Number(e.target.value))} className={inputCls} />
        </Field>
        <Field label={m.fSeats}>
          <input type="number" min={1} placeholder="1" value={seats} onChange={(e) => setSeats(e.target.value === '' ? '' : Number(e.target.value))} className={inputCls} />
        </Field>
      </div>
      <Field label={m.fSchedule}>
        <select value={scheduleId} onChange={(e) => setScheduleId(e.target.value)} className={inputCls}>
          <option value="">
            {schedules.length ? m.useDefaultSchedule : m.noSchedules}
          </option>
          {schedules.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </Field>

      {isTeamEvent && scheduling ? (
        <div className="flex flex-col gap-4 rounded-md border border-border bg-background/40 p-4">
          <Field label={m.schedulingMethod}>
            <select
              value={schedulingType}
              onChange={(e) => setSchedulingType(e.target.value as SchedulingMethod)}
              className={inputCls}
            >
              {SCHEDULING_METHODS.map((method) => (
                <option key={method} value={method}>
                  {scheduling[method]}
                </option>
              ))}
            </select>
            <span className="mt-1 text-xs text-muted-foreground">{scheduling[`${schedulingType}_hint`]}</span>
          </Field>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-semibold text-muted-foreground">{m.hostsTitle}</span>
            {/* Column header — only the fields the active method actually uses. */}
            {schedulingType !== 'collective' ? (
              <div className="flex items-center gap-3 px-1 text-xs text-muted-foreground">
                <span className="flex-1" />
                <span className="w-20 text-center">{m.priority}</span>
                <span className="w-20 text-center">{m.weight}</span>
                {schedulingType === 'fixed_round_robin' ? (
                  <span className="w-16 text-center">{m.fixedHost}</span>
                ) : null}
              </div>
            ) : null}
            {hosts.map((h) => {
              const name = teamMembers!.find((tm) => tm.memberId === h.memberId)?.displayName ?? h.memberId;
              return (
                <div key={h.memberId} className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2">
                  <span className="flex-1 text-sm">{name}</span>
                  {schedulingType !== 'collective' ? (
                    <>
                      <input
                        type="number"
                        aria-label={`${name} — ${m.priority}`}
                        value={h.priority ?? 0}
                        onChange={(e) => setHost(h.memberId, { priority: Number(e.target.value) })}
                        className="w-20 rounded-md border border-input bg-background px-2 py-1 text-center text-sm"
                      />
                      <input
                        type="number"
                        min={1}
                        aria-label={`${name} — ${m.weight}`}
                        value={h.weight ?? 100}
                        onChange={(e) => setHost(h.memberId, { weight: Number(e.target.value) })}
                        className="w-20 rounded-md border border-input bg-background px-2 py-1 text-center text-sm"
                      />
                      {schedulingType === 'fixed_round_robin' ? (
                        <label className="flex w-16 cursor-pointer justify-center" title={m.fixedHostHint}>
                          <Checkbox
                            checked={h.isFixed}
                            onChange={(e) => setHost(h.memberId, { isFixed: e.target.checked })}
                          />
                        </label>
                      ) : null}
                    </>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="flex gap-6">
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <Checkbox checked={requiresConfirmation} onChange={(e) => setRequiresConf(e.target.checked)} />
          {m.requiresConfirmation}
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <Checkbox checked={hidden} onChange={(e) => setHidden(e.target.checked)} />
          {m.hiddenLabel}
        </label>
      </div>

      {/* Intake questions */}
      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold text-muted-foreground">{m.intakeQuestions}</span>
        {fields.map((f, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              placeholder={m.namePlaceholder}
              value={f.name}
              onChange={(e) => setFields((fs) => fs.map((x, j) => (j === i ? { ...x, name: e.target.value.replace(/[^a-zA-Z0-9_]/g, '') } : x)))}
              className="w-28 rounded-md border border-input bg-background px-2 py-1 text-sm"
            />
            <input
              placeholder={m.labelPlaceholder}
              value={f.label}
              onChange={(e) => setFields((fs) => fs.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
              className="flex-1 rounded-md border border-input bg-background px-2 py-1 text-sm"
            />
            <select
              value={f.type}
              onChange={(e) => setFields((fs) => fs.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)))}
              className="rounded-md border border-input bg-background px-2 py-1 text-sm"
            >
              {FIELD_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <label className="flex cursor-pointer items-center gap-1 text-sm">
              <Checkbox checked={f.required} onChange={(e) => setFields((fs) => fs.map((x, j) => (j === i ? { ...x, required: e.target.checked } : x)))} />
              {m.req}
            </label>
            <button type="button" onClick={() => setFields((fs) => fs.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-destructive">×</button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setFields((fs) => [...fs, { name: '', label: '', type: 'text', required: false }])}
          className="self-start rounded-md border border-border px-3 py-1 text-sm text-muted-foreground hover:border-primary"
        >
          {m.addQuestion}
        </button>
      </div>

      {res && !res.ok ? <p className="text-sm text-destructive">{res.message}</p> : null}
      {res?.ok ? <p className="text-sm text-primary">{m.saved}</p> : null}
      </div>
    </form>
  );
}

const inputCls =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm transition-colors placeholder:text-muted-foreground hover:border-muted-foreground focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
