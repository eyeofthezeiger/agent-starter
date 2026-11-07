import type { Queryable } from "./db.ts";
import { enqueueJob } from "./jobs.ts";

/**
 * Scheduled jobs. Each tick works out which "slot" every schedule is in and
 * enqueues a job with that slot as its dedupe key. Restarts and multiple ticks
 * in the same slot never create duplicates, and a missed daily slot fires once
 * when the service comes back the same day.
 */
export type ScheduleSpec =
  | { name: string; jobType: string; everyMinutes: number }
  | { name: string; jobType: string; dailyAt: string };

export interface DueSlot {
  name: string;
  jobType: string;
  slotKey: string;
}

export function localParts(now: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const p = Object.fromEntries(fmt.formatToParts(now).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hhmm: `${p.hour}:${p.minute}` };
}

export function dueSlots(specs: ScheduleSpec[], now: Date, timeZone: string): DueSlot[] {
  const out: DueSlot[] = [];
  const local = localParts(now, timeZone);
  for (const spec of specs) {
    if ("everyMinutes" in spec) {
      const slot = Math.floor(now.getTime() / (spec.everyMinutes * 60_000));
      out.push({ name: spec.name, jobType: spec.jobType, slotKey: `${spec.name}:${slot}` });
    } else if (local.hhmm >= spec.dailyAt) {
      out.push({ name: spec.name, jobType: spec.jobType, slotKey: `${spec.name}:${local.date}` });
    }
  }
  return out;
}

export async function tickScheduler(db: Queryable, specs: ScheduleSpec[], now: Date, timeZone: string): Promise<number> {
  let created = 0;
  for (const slot of dueSlots(specs, now, timeZone)) {
    if (await enqueueJob(db, { type: slot.jobType, payload: { slot: slot.slotKey }, dedupeKey: slot.slotKey })) created++;
  }
  return created;
}
