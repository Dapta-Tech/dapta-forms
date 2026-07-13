'use server';

import { unstable_rethrow } from 'next/navigation';

import { revalidatePath } from 'next/cache';
import { adminApi } from '@/lib/admin-api';

export type ActionResult = { ok: boolean; message?: string };

export interface RuleInput {
  days: number[] | null;
  startTime: string;
  endTime: string;
  date: string | null;
}

export async function saveScheduleFullAction(
  scheduleId: string,
  name: string,
  timeZone: string,
  rules: RuleInput[],
): Promise<ActionResult> {
  // Backstop: end > start on every rule (the editor validates overlap client-side).
  for (const r of rules) {
    if (r.endTime <= r.startTime) {
      return { ok: false, message: `A block ends before it starts (${r.startTime}–${r.endTime}).` };
    }
  }
  try {
    await adminApi.updateSchedule(scheduleId, { name: name.trim() || 'Schedule', timeZone, rules });
    revalidatePath('/admin/availability');
    return { ok: true };
  } catch (e) {
    unstable_rethrow(e); // let a 401→/login redirect through
    return { ok: false, message: e instanceof Error ? e.message : 'Failed' };
  }
}

/** Seed a new schedule with sensible defaults — Mon–Fri 09:00–17:00 — so it
 *  opens ready to tweak (one screen), not blank. Matches Cal.com/Calendly. */
const DEFAULT_RULES: RuleInput[] = [
  { days: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '17:00', date: null },
];

export async function createScheduleAction(
  name: string,
  timeZone: string,
): Promise<ActionResult & { id?: string }> {
  try {
    const created = await adminApi.createSchedule({
      name: name.trim() || 'Working hours',
      timeZone,
      rules: DEFAULT_RULES,
    });
    revalidatePath('/admin/availability');
    return { ok: true, id: created.id };
  } catch (e) {
    unstable_rethrow(e); // let a 401→/login redirect through
    return { ok: false, message: e instanceof Error ? e.message : 'Failed' };
  }
}

export async function deleteScheduleAction(id: string): Promise<ActionResult> {
  try {
    await adminApi.deleteSchedule(id);
    revalidatePath('/admin/availability');
    return { ok: true };
  } catch (e) {
    unstable_rethrow(e); // let a 401→/login redirect through
    return { ok: false, message: e instanceof Error ? e.message : 'Could not delete schedule.' };
  }
}
