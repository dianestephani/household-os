import { TodayPlan } from '../db/models/TodayPlan.js';
import { ContextEntry } from '../db/models/ContextEntry.js';
import { addDays, parseYmd, ymd } from '../utils/dates.js';
import { generateTodayPlan } from '../cron/morning-gen.js';
import { scheduleRange } from './schedule.js';
import type {
  ContextEntry as ContextEntryType,
  DayView,
  TodayPlan as TodayPlanType,
} from '@household-os/shared/types';

/**
 * Single-day bundle used by the dashboard's day navigator. Three regimes:
 *
 *   - Today  → existing plan (auto-create if morning-gen hasn't run yet),
 *              calendar events, today's journal entries.
 *   - Past   → stored plan if morning-gen produced one that day, else null.
 *              No forecast is synthesized for past days because the rolling
 *              `last_done` math reflects current state, not historical state,
 *              and a synthesized forecast would be misleading.
 *   - Future → forecast from `scheduleRange(date, 1)` — what *would* be due
 *              that day at current `last_done` values. Forward-look only.
 *
 * Calendar events + context entries are looked up for any date.
 */
export async function getDayView(dateStr: string): Promise<DayView> {
  const date = parseYmd(dateStr);
  const todayKey = ymd(new Date());
  const isToday = dateStr === todayKey;
  const today = parseYmd(todayKey);
  const isPast = date.getTime() < today.getTime();
  const isFuture = date.getTime() > today.getTime();

  let plan: TodayPlanType | null = null;
  if (isToday) {
    let existing = await TodayPlan.findOne({ date: dateStr }).lean();
    if (!existing) {
      const { planId } = await generateTodayPlan(new Date());
      existing = await TodayPlan.findById(planId).lean();
    }
    plan = (existing as unknown as TodayPlanType) ?? null;
  } else if (isPast) {
    const existing = await TodayPlan.findOne({ date: dateStr }).lean();
    plan = (existing as unknown as TodayPlanType | null) ?? null;
  }

  // scheduleRange runs deterministically against current state. We only
  // surface its output as a `forecast` for future days.
  const range = await scheduleRange(date, 1);
  const dayEntry = range.days[0]!;

  const forecast = isFuture ? dayEntry.routines_due : [];

  const start = parseYmd(dateStr);
  const end = addDays(start, 1);
  const ctxDocs = await ContextEntry.find({
    ts: { $gte: start, $lt: end },
  })
    .sort({ ts: -1 })
    .lean();

  return {
    date: dateStr,
    is_today: isToday,
    is_past: isPast,
    is_future: isFuture,
    plan,
    forecast,
    events: dayEntry.events,
    context: ctxDocs as unknown as ContextEntryType[],
  };
}
