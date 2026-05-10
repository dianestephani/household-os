import inventory from '@household-os/shared/inventory.json' with { type: 'json' };
import { Routine } from '../db/models/Routine.js';
import { Trigger } from '../db/models/Trigger.js';
import { AdHocTask } from '../db/models/AdHocTask.js';
import { isCalendarConnected, listEvents } from '../utils/google-calendar.js';
import { addDays, dayOfWeek, diffDays, parseYmd, ymd } from '../utils/dates.js';
import { normalizeEvent, openInCalendarUrl } from './calendar.js';
import type {
  CalendarEvent,
  EnergyLevel,
  ScheduleEntry,
  SchedulePendingAdHoc,
  ScheduleRangeResponse,
  ScheduleRoutineDue,
  TriggerType,
  Zone,
  ZoneStateLevel,
} from '@household-os/shared/types';

const FIXED_EPOCH = new Date(2026, 0, 1); // Same anchor morning-gen uses for biweekly cycle parity

/** Inclusive lower bound, exclusive upper bound, all at local midnight. */
export function buildWindow(
  now: Date,
  days: number,
): { start: Date; end: Date } {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = addDays(start, days);
  return { start, end };
}

/**
 * Rolling routines: each routine appears once on its earliest due day in the
 * window. Anything already overdue at window start is bucketed on day 0.
 *
 * `skip_if: 'landscaper_this_week'` is honored: if the routine's would-be
 * due day falls in a 7-day window with a landscaper trigger, skip it.
 */
async function rollingDueByDay(
  start: Date,
  end: Date,
): Promise<Map<string, ScheduleRoutineDue[]>> {
  const result = new Map<string, ScheduleRoutineDue[]>();
  const routines = await Routine.find({
    'scheduling.type': 'rolling',
    active: true,
  }).lean();

  // Pre-fetch landscaper triggers in the window plus a small back-buffer so
  // skip_if can resolve without per-routine round trips.
  const landscaperWindowStart = ymd(addDays(start, -7));
  const landscaperWindowEnd = ymd(addDays(end, 7));
  const landscapers = await Trigger.find({
    type: 'landscaper',
    date: { $gte: landscaperWindowStart, $lte: landscaperWindowEnd },
  }).lean();
  const landscaperDates = landscapers.map((t) => parseYmd(t.date));

  for (const r of routines) {
    const interval = r.scheduling?.interval_days ?? 1;
    // Normalize last_done to local midnight — markDone records `new Date()`
    // at whatever wall-clock time it was called, but the interval math is
    // day-granular and shouldn't be off-by-one based on time of day.
    const last = r.last_done ? startOfDay(new Date(r.last_done)) : null;

    let bucket: Date | null = null;
    let note: string;
    if (!last) {
      bucket = start;
      note = 'never done';
    } else {
      const nextDue = addDays(last, interval);
      if (nextDue < start) {
        bucket = start;
        note = `overdue ${diffDays(start, nextDue)}d`;
      } else if (nextDue < end) {
        bucket = startOfDay(nextDue);
        note = 'due';
      } else {
        continue;
      }
    }

    if (r.skip_if === 'landscaper_this_week') {
      const inLandscaperWeek = landscaperDates.some(
        (d) => Math.abs(diffDays(bucket!, d)) <= 7,
      );
      if (inLandscaperWeek) continue;
    }

    push(result, ymd(bucket), {
      routine_key: r.key,
      name: r.name ?? r.key,
      category: r.category ?? undefined,
      estimate_minutes: r.estimate_minutes ?? 0,
      energy: (r.energy as EnergyLevel) ?? 'low',
      source: 'rolling',
      cadence_note: note,
    });
  }
  return result;
}

/**
 * Fixed routines (trash bins etc): walk every day in the window, match
 * day_of_week + biweekly cycle the same way morning-gen does.
 */
async function fixedDueByDay(
  start: Date,
  end: Date,
): Promise<Map<string, ScheduleRoutineDue[]>> {
  const result = new Map<string, ScheduleRoutineDue[]>();
  const routines = await Routine.find({
    'scheduling.type': 'fixed',
    active: true,
  }).lean();

  for (let d = new Date(start); d < end; d = addDays(d, 1)) {
    const dow = dayOfWeek(d);
    const weekIndex = Math.floor(diffDays(d, FIXED_EPOCH) / 7);

    for (const r of routines) {
      if (r.scheduling?.day_of_week !== dow) continue;
      if (r.scheduling?.biweekly && weekIndex % 2 !== 0) continue;
      push(result, ymd(d), {
        routine_key: r.key,
        name: r.name ?? r.key,
        category: r.category ?? undefined,
        estimate_minutes: r.estimate_minutes ?? 0,
        energy: (r.energy as EnergyLevel) ?? 'low',
        source: 'fixed',
        cadence_note: r.scheduling?.biweekly ? 'biweekly' : 'weekly',
      });
    }
  }
  return result;
}

/**
 * Zone rotation: same logic as morning-gen — runs only on Sat/Sun, computes
 * which week-of-cycle by weeks-since-last-cleaner-visit. No cleaner trigger
 * on file → no zone task surfaced.
 */
async function zoneRotationByDay(
  start: Date,
  end: Date,
): Promise<Map<string, ScheduleRoutineDue[]>> {
  const result = new Map<string, ScheduleRoutineDue[]>();
  const lastCleaner = await Trigger.findOne({ type: 'cleaner_visit' })
    .sort({ date: -1 })
    .lean();
  if (!lastCleaner) return result;

  const lastCleanerDate = parseYmd(lastCleaner.date);

  for (let d = new Date(start); d < end; d = addDays(d, 1)) {
    const dow = d.getDay();
    if (dow !== 6 && dow !== 0) continue;
    const weeksSince = Math.floor(diffDays(d, lastCleanerDate) / 7);
    if (weeksSince < 0) continue;
    const week = (weeksSince % 6) + 1;
    const entry = inventory.zone_rotation_6wk.find((z) => z.week === week);
    if (!entry?.task) continue;

    push(result, ymd(d), {
      routine_key: `zone_week_${week}`,
      name: `Zone rotation week ${week}: ${entry.task}`,
      category: 'cleaning',
      estimate_minutes: entry.estimate_minutes,
      energy: entry.energy as EnergyLevel,
      source: 'zone_rotation',
      cadence_note: `week ${week} of 6`,
    });
  }
  return result;
}

const TRIGGER_OFFSETS: Record<string, { triggerType: TriggerType; offsetDays: number }> = {
  airbnb_checkin_minus_1d: { triggerType: 'airbnb_checkin', offsetDays: -1 },
  airbnb_checkout_same_day: { triggerType: 'airbnb_checkout', offsetDays: 0 },
  dogsit_arrival_minus_1d: { triggerType: 'dogsit_arrival', offsetDays: -1 },
  dogsit_departure_same_day: { triggerType: 'dogsit_departure', offsetDays: 0 },
  landscaper_date: { triggerType: 'landscaper', offsetDays: 0 },
};

const TRIGGER_NOTES: Record<TriggerType, (offsetDays: number) => string> = {
  airbnb_checkin: (o) => (o === -1 ? 'Airbnb checkin tomorrow' : 'Airbnb checkin'),
  airbnb_checkout: () => 'Airbnb checkout today',
  dogsit_arrival: (o) => (o === -1 ? 'Dogsit arrival tomorrow' : 'Dogsit arrival'),
  dogsit_departure: () => 'Dogsit departure today',
  landscaper: () => 'Landscaper today',
  cleaner_visit: () => 'Cleaner visit',
};

/**
 * Event-driven routines: pull triggers in (window − 7d, window + 7d), match
 * each routine's `scheduling.trigger` to a TRIGGER_OFFSETS entry, then bucket
 * the routine on `triggerDate + offsetDays` if that falls in the window.
 */
async function eventDrivenByDay(
  start: Date,
  end: Date,
): Promise<Map<string, ScheduleRoutineDue[]>> {
  const result = new Map<string, ScheduleRoutineDue[]>();
  const routines = await Routine.find({
    'scheduling.type': 'event_driven',
    active: true,
  }).lean();
  if (routines.length === 0) return result;

  const triggers = await Trigger.find({
    date: {
      $gte: ymd(addDays(start, -7)),
      $lte: ymd(addDays(end, 7)),
    },
  }).lean();

  for (const r of routines) {
    const triggerKey = r.scheduling?.trigger;
    if (!triggerKey) continue;
    const cfg = TRIGGER_OFFSETS[triggerKey];
    if (!cfg) continue;
    for (const t of triggers) {
      if (t.type !== cfg.triggerType) continue;
      const fireDay = addDays(parseYmd(t.date), cfg.offsetDays);
      if (fireDay < start || fireDay >= end) continue;
      push(result, ymd(fireDay), {
        routine_key: r.key,
        name: r.name ?? r.key,
        category: r.category ?? undefined,
        estimate_minutes: r.estimate_minutes ?? 0,
        energy: (r.energy as EnergyLevel) ?? 'low',
        source: 'event_driven',
        cadence_note: TRIGGER_NOTES[cfg.triggerType](cfg.offsetDays),
      });
    }
  }
  return result;
}

export async function pendingAdHocTasks(): Promise<SchedulePendingAdHoc[]> {
  const tasks = await AdHocTask.find({ status: 'open' })
    .sort({ ts: 1 })
    .lean();
  return tasks.map((t) => ({
    id: String(t._id),
    name: t.name,
    zone: t.zone as Zone,
    severity: (t.severity ?? 'meh') as ZoneStateLevel,
    estimate_minutes: t.estimate_minutes ?? 0,
  }));
}

export async function scheduleRange(
  now: Date = new Date(),
  days = 7,
): Promise<ScheduleRangeResponse> {
  const clampedDays = Math.max(1, Math.min(60, Math.floor(days)));
  const { start, end } = buildWindow(now, clampedDays);
  const todayKey = ymd(now);

  const [rolling, fixed, zone, eventDriven, adhoc] = await Promise.all([
    rollingDueByDay(start, end),
    fixedDueByDay(start, end),
    zoneRotationByDay(start, end),
    eventDrivenByDay(start, end),
    pendingAdHocTasks(),
  ]);

  const calendarConnected = isCalendarConnected();
  const events = calendarConnected
    ? (await listEvents(start.toISOString(), end.toISOString()))
        .map(normalizeEvent)
        .filter((e): e is CalendarEvent => e !== null)
    : [];
  const eventsByDay = bucketEvents(events);

  const dayList: ScheduleEntry[] = [];
  for (let d = new Date(start); d < end; d = addDays(d, 1)) {
    const key = ymd(d);
    const routinesDue = [
      ...(rolling.get(key) ?? []),
      ...(fixed.get(key) ?? []),
      ...(zone.get(key) ?? []),
      ...(eventDriven.get(key) ?? []),
    ];
    dayList.push({
      date: key,
      is_today: key === todayKey,
      events: eventsByDay.get(key) ?? [],
      routines_due: routinesDue,
    });
  }

  const view = clampedDays > 14 ? 'month' : clampedDays > 1 ? 'week' : 'day';
  return {
    start: ymd(start),
    end: ymd(end),
    days: dayList,
    pending_adhoc_tasks: adhoc,
    calendar_connected: calendarConnected,
    open_in_calendar_url: openInCalendarUrl(start, view),
  };
}

// ----- helpers -----

function startOfDay(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function push(
  map: Map<string, ScheduleRoutineDue[]>,
  key: string,
  entry: ScheduleRoutineDue,
): void {
  const list = map.get(key);
  if (list) list.push(entry);
  else map.set(key, [entry]);
}

/**
 * Bin events by their start day. All-day events use their YYYY-MM-DD start
 * directly; timed events are bucketed by local-midnight day.
 */
function bucketEvents(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const byDay = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    const day = e.is_all_day ? e.start : ymd(new Date(e.start));
    const list = byDay.get(day);
    if (list) list.push(e);
    else byDay.set(day, [e]);
  }
  return byDay;
}
