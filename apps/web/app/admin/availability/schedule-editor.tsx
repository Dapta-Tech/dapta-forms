'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { commonTimeZones, validateDayRanges, type BookingMessages, type TimeRange } from '@slate/shared';
import { useToast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { FormHeader } from '@/components/ui/page-header';
import { TimeField } from '@/components/ui/time-field';
import type { Schedule } from '@/lib/admin-api';
import { deleteScheduleAction, saveScheduleFullAction, type RuleInput } from './actions';

type AvailabilityMessages = BookingMessages['admin']['availability'];

interface Override {
  date: string;
  start: string;
  end: string;
}

/** Seed each weekday with ALL of its ranges (was: last-rule-wins → data loss). */
function seedWeek(schedule: Schedule): TimeRange[][] {
  const week: TimeRange[][] = Array.from({ length: 7 }, () => []);
  for (const r of schedule.rules) {
    if (!r.days) continue;
    for (const d of r.days) week[d]!.push({ start: r.startTime, end: r.endTime });
  }
  return week;
}

export function ScheduleEditor({
  schedule,
  messages: m,
  backHref,
  backLabel,
}: {
  schedule: Schedule;
  messages: AvailabilityMessages;
  backHref: string;
  backLabel: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(schedule.name);
  const [timeZone, setTimeZone] = useState(schedule.timeZone);
  const [week, setWeek] = useState<TimeRange[][]>(() => seedWeek(schedule));
  const [overrides, setOverrides] = useState<Override[]>(() =>
    schedule.rules.filter((r) => r.date).map((r) => ({ date: r.date!, start: r.startTime, end: r.endTime })),
  );
  const [confirmDel, setConfirmDel] = useState(false);
  const [pending, start] = useTransition();
  const { success, error } = useToast();
  const zones = useMemo(() => commonTimeZones(timeZone), [timeZone]);

  const setRanges = (d: number, ranges: TimeRange[]) =>
    setWeek((w) => w.map((r, i) => (i === d ? ranges : r)));
  const toggleDay = (d: number, on: boolean) =>
    setRanges(d, on ? [{ start: '09:00', end: '17:00' }] : []);
  const addRange = (d: number) => setRanges(d, [...week[d]!, { start: '09:00', end: '17:00' }]);

  // Per-day overlap/inverted validation (blocks Save with a clear message).
  const dayError = (d: number) => (week[d]!.length ? validateDayRanges(week[d]!) : null);
  const firstError = week.map((_, d) => dayError(d)).find(Boolean) ?? null;

  const save = () =>
    start(async () => {
      if (firstError) {
        error(firstError);
        return;
      }
      const rules: RuleInput[] = [];
      week.forEach((ranges, d) => {
        for (const r of ranges) rules.push({ days: [d], startTime: r.start, endTime: r.end, date: null });
      });
      for (const o of overrides) {
        if (o.date) rules.push({ days: null, startTime: o.start, endTime: o.end, date: o.date });
      }
      const res = await saveScheduleFullAction(schedule.id, name, timeZone, rules);
      if (res.ok) success(m.savedToast);
      else error(res.message ?? m.saveError);
    });

  const remove = () =>
    start(async () => {
      const r = await deleteScheduleAction(schedule.id);
      if (!r.ok) error(r.message ?? m.deleteError);
      else {
        success(m.deletedToast);
        router.push(backHref);
      }
    });

  const actions = (
    <>
      {confirmDel ? (
        <span className="flex items-center gap-1 text-sm">
          <span className="hidden text-muted-foreground sm:inline">{m.deletePrompt}</span>
          <button type="button" onClick={remove} disabled={pending} className="rounded-md border border-destructive px-3 py-2 text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-60">
            {m.yes}
          </button>
          <button type="button" onClick={() => setConfirmDel(false)} className="rounded-md border border-border px-3 py-2 transition-colors hover:bg-accent">
            {m.no}
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setConfirmDel(true)}
          className="rounded-md border border-destructive px-3 py-2 text-sm text-destructive transition-colors hover:bg-destructive/10"
        >
          {m.deleteSchedule}
        </button>
      )}
      <Button type="submit" disabled={pending || !!firstError}>
        {pending ? m.saving : m.save}
      </Button>
    </>
  );

  return (
    <form onSubmit={(e) => { e.preventDefault(); save(); }}>
      <FormHeader
        backHref={backHref}
        backLabel={backLabel}
        actions={actions}
        title={
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label={m.scheduleNameLabel}
            className="w-full min-w-0 rounded-md border border-transparent bg-transparent px-1 text-2xl font-semibold tracking-tight hover:border-border focus:border-input focus-visible:outline-none"
          />
        }
      />

      <div className="flex flex-col gap-4">
      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        {m.timezone}
        <select
          value={timeZone}
          onChange={(e) => setTimeZone(e.target.value)}
          className="rounded-md border border-input bg-background px-2 py-1.5 text-foreground"
        >
          {zones.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </select>
      </label>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold text-muted-foreground">{m.weeklyHours}</span>
        {m.days.map((dayName, d) => {
          const ranges = week[d]!;
          const on = ranges.length > 0;
          const err = dayError(d);
          return (
            <div key={d} className="flex flex-col gap-1 border-b border-border/50 py-2 last:border-b-0">
              <div className="flex flex-wrap items-start gap-3">
                <label className="flex w-32 shrink-0 cursor-pointer items-center gap-2 py-1.5 text-sm">
                  <Checkbox checked={on} onChange={(e) => toggleDay(d, e.target.checked)} />
                  {dayName}
                </label>
                {on ? (
                  <div className="flex flex-1 flex-col gap-2">
                    {ranges.map((r, ri) => (
                      <div key={ri} className="flex items-center gap-2">
                        <TimeField
                          className="w-32"
                          aria-label={`${dayName} start`}
                          value={r.start}
                          onChange={(v) => setRanges(d, ranges.map((x, j) => (j === ri ? { ...x, start: v } : x)))}
                        />
                        <span className="text-muted-foreground">–</span>
                        <TimeField
                          className="w-32"
                          aria-label={`${dayName} end`}
                          value={r.end}
                          onChange={(v) => setRanges(d, ranges.map((x, j) => (j === ri ? { ...x, end: v } : x)))}
                        />
                        <button
                          type="button"
                          aria-label={m.removeRange}
                          onClick={() => setRanges(d, ranges.filter((_, j) => j !== ri))}
                          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-destructive"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => addRange(d)}
                      className="self-start text-xs text-primary hover:underline"
                    >
                      {m.addRange}
                    </button>
                  </div>
                ) : (
                  <span className="py-1.5 text-sm text-muted-foreground">{m.unavailable}</span>
                )}
              </div>
              {err ? <span className="pl-32 text-xs text-destructive">{err}</span> : null}
            </div>
          );
        })}
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold text-muted-foreground">{m.dateOverrides}</span>
        {overrides.map((o, i) => (
          <div key={i} className="flex items-center gap-3">
            <input
              type="date"
              value={o.date}
              onChange={(e) => setOverrides((os) => os.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)))}
              className="rounded-md border border-input bg-background px-2 py-1"
            />
            <TimeField
              className="w-32"
              value={o.start}
              onChange={(v) => setOverrides((os) => os.map((x, j) => (j === i ? { ...x, start: v } : x)))}
            />
            <span className="text-muted-foreground">–</span>
            <TimeField
              className="w-32"
              value={o.end}
              onChange={(v) => setOverrides((os) => os.map((x, j) => (j === i ? { ...x, end: v } : x)))}
            />
            <button
              type="button"
              onClick={() => setOverrides((os) => os.filter((_, j) => j !== i))}
              className="text-muted-foreground hover:text-destructive"
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setOverrides((os) => [...os, { date: '', start: '09:00', end: '17:00' }])}
          className="self-start rounded-md border border-border px-3 py-1 text-sm text-muted-foreground hover:border-primary"
        >
          {m.addOverride}
        </button>
        <p className="text-xs text-muted-foreground">{m.overrideNote}</p>
      </div>
      </div>
    </form>
  );
}
