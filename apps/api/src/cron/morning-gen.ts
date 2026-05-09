import { Routine } from '../db/models/Routine.js';
import { TodayPlan } from '../db/models/TodayPlan.js';
import { Trigger } from '../db/models/Trigger.js';
import { addDays, dayOfWeek, diffDays, parseYmd, ymd } from '../utils/dates.js';
import { classifyDay } from '../utils/day-classify.js';
import inventory from '@household-os/shared/inventory.json' with { type: 'json' };
import type { DayType, EnergyLevel } from '@household-os/shared/types';

interface Candidate {
  routine_key: string;
  name: string;
  estimate_minutes: number;
  energy: EnergyLevel;
  /** lower = higher priority */
  priority: number;
}

const ENERGY_RANK: Record<EnergyLevel, number> = { low: 1, medium: 2, high: 3 };

async function dueRollingRoutines(today: Date): Promise<Candidate[]> {
  const routines = await Routine.find({
    'scheduling.type': 'rolling',
    active: true,
  }).lean();

  const result: Candidate[] = [];
  for (const r of routines) {
    const interval = r.scheduling?.interval_days ?? 1;
    const flex = r.scheduling?.flex_days ?? 0;
    const last = r.last_done ? new Date(r.last_done) : null;
    const daysSince = last ? diffDays(today, last) : Infinity;

    if (daysSince + flex < interval) continue;

    const overdue = Math.max(0, daysSince - interval);
    result.push({
      routine_key: r.key,
      name: r.name ?? r.key,
      estimate_minutes: r.estimate_minutes ?? 0,
      energy: (r.energy as EnergyLevel) ?? 'low',
      priority: -overdue,
    });
  }
  return result;
}

async function todaysFixedRoutines(today: Date): Promise<Candidate[]> {
  const dow = dayOfWeek(today);
  const routines = await Routine.find({
    'scheduling.type': 'fixed',
    'scheduling.day_of_week': dow,
    active: true,
  }).lean();

  const result: Candidate[] = [];
  const epoch = new Date(2026, 0, 1);
  const weekIndex = Math.floor(diffDays(today, epoch) / 7);

  for (const r of routines) {
    if (r.scheduling?.biweekly && weekIndex % 2 !== 0) continue;
    result.push({
      routine_key: r.key,
      name: r.name ?? r.key,
      estimate_minutes: r.estimate_minutes ?? 0,
      energy: (r.energy as EnergyLevel) ?? 'low',
      priority: 1,
    });
  }
  return result;
}

async function currentZoneTaskIfNotDone(today: Date): Promise<Candidate[]> {
  const lastCleaner = await Trigger.findOne({ type: 'cleaner_visit' })
    .sort({ date: -1 })
    .lean();

  if (!lastCleaner) return [];

  const last = parseYmd(lastCleaner.date);
  const weeksSince = Math.floor(diffDays(today, last) / 7);
  if (weeksSince < 0) return [];

  const week = (weeksSince % 6) + 1;
  const entry = inventory.zone_rotation_6wk.find((z) => z.week === week);
  if (!entry || !entry.task) return [];

  const dow = today.getDay();
  if (dow !== 6 && dow !== 0) return [];

  return [
    {
      routine_key: `zone_week_${week}`,
      name: `Zone rotation week ${week}: ${entry.task}`,
      estimate_minutes: entry.estimate_minutes,
      energy: entry.energy as EnergyLevel,
      priority: 2,
    },
  ];
}

const TRIGGER_PATTERNS: Record<
  string,
  { triggerType: string; offsetDays: number }
> = {
  airbnb_checkin_minus_1d: { triggerType: 'airbnb_checkin', offsetDays: -1 },
  airbnb_checkout_same_day: { triggerType: 'airbnb_checkout', offsetDays: 0 },
  dogsit_arrival_minus_1d: { triggerType: 'dogsit_arrival', offsetDays: -1 },
  dogsit_departure_same_day: { triggerType: 'dogsit_departure', offsetDays: 0 },
  landscaper_date: { triggerType: 'landscaper', offsetDays: 0 },
};

async function landscaperThisWeek(today: Date): Promise<boolean> {
  const start = ymd(today);
  const end = ymd(addDays(today, 7));
  const t = await Trigger.findOne({
    type: 'landscaper',
    date: { $gte: start, $lte: end },
  }).lean();
  return !!t;
}

async function resolveTriggers(today: Date): Promise<Candidate[]> {
  const eventDriven = await Routine.find({
    'scheduling.type': 'event_driven',
    active: true,
  }).lean();

  const result: Candidate[] = [];
  const todayStr = ymd(today);

  for (const r of eventDriven) {
    const triggerKey = r.scheduling?.trigger;
    if (!triggerKey) continue;
    const pattern = TRIGGER_PATTERNS[triggerKey];
    if (!pattern) continue;

    const targetDate = ymd(addDays(today, -pattern.offsetDays));
    const trigger = await Trigger.findOne({
      type: pattern.triggerType,
      date: targetDate,
    }).lean();
    if (!trigger) continue;

    if (r.skip_if === 'landscaper_this_week' && (await landscaperThisWeek(today))) {
      continue;
    }

    result.push({
      routine_key: r.key,
      name: r.name ?? r.key,
      estimate_minutes: r.estimate_minutes ?? 0,
      energy: (r.energy as EnergyLevel) ?? 'low',
      priority: -10,
    });

    if (r.also_triggers && r.also_triggers.length) {
      for (const otherKey of r.also_triggers) {
        const other = await Routine.findOne({ key: otherKey }).lean();
        if (!other) continue;
        if (
          other.skip_if === 'landscaper_this_week' &&
          (await landscaperThisWeek(today))
        ) {
          continue;
        }
        if (result.some((c) => c.routine_key === otherKey)) continue;
        result.push({
          routine_key: other.key,
          name: other.name ?? other.key,
          estimate_minutes: other.estimate_minutes ?? 0,
          energy: (other.energy as EnergyLevel) ?? 'low',
          priority: -5,
        });
      }
    }
  }

  // De-dup
  const byKey = new Map<string, Candidate>();
  for (const c of result) {
    if (!byKey.has(c.routine_key)) byKey.set(c.routine_key, c);
  }
  void todayStr;
  return Array.from(byKey.values());
}

function prioritize(candidates: Candidate[]): Candidate[] {
  return [...candidates].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return ENERGY_RANK[b.energy] - ENERGY_RANK[a.energy];
  });
}

function packIntoBudget(
  sorted: Candidate[],
  budget: number,
): { packed: Candidate[]; overflow: Candidate[] } {
  const packed: Candidate[] = [];
  const overflow: Candidate[] = [];
  let used = 0;
  for (const c of sorted) {
    if (used + c.estimate_minutes <= budget) {
      packed.push(c);
      used += c.estimate_minutes;
    } else {
      overflow.push(c);
    }
  }
  return { packed, overflow };
}

export interface GenerateOptions {
  /** If true, replace any existing TodayPlan for that date. */
  force?: boolean;
}

export async function generateTodayPlan(
  date: Date = new Date(),
  options: GenerateOptions = {},
): Promise<{ planId: string; created: boolean }> {
  const dateStr = ymd(date);
  const existing = await TodayPlan.findOne({ date: dateStr });
  if (existing && !options.force) {
    return { planId: existing.id, created: false };
  }

  const dayType: DayType = await classifyDay(date);
  const budget =
    inventory.energy_budgets_minutes[dayType] ??
    inventory.energy_budgets_minutes.weekday_default;

  const candidates = [
    ...(await dueRollingRoutines(date)),
    ...(await todaysFixedRoutines(date)),
    ...(await currentZoneTaskIfNotDone(date)),
    ...(await resolveTriggers(date)),
  ];

  const sorted = prioritize(candidates);
  const { packed, overflow } = packIntoBudget(sorted, budget);

  const items = packed.map((c, i) => ({
    routine_key: c.routine_key,
    name: c.name,
    estimate_minutes: c.estimate_minutes,
    energy: c.energy,
    status: 'pending',
    order: i,
  }));

  const swap_pool = overflow.map((c) => ({
    routine_key: c.routine_key,
    name: c.name,
    estimate_minutes: c.estimate_minutes,
    energy: c.energy,
    deferred_at: new Date(),
    reason: 'over_budget',
  }));

  if (existing) {
    existing.set({
      day_type: dayType,
      budget_minutes: budget,
      current_energy: 'medium',
      items,
      swap_pool,
      publisher: existing.publisher ?? {},
    });
    await existing.save();
    return { planId: existing.id, created: false };
  }

  const plan = await TodayPlan.create({
    date: dateStr,
    day_type: dayType,
    budget_minutes: budget,
    current_energy: 'medium',
    items,
    swap_pool,
    publisher: {},
  });
  return { planId: plan.id, created: true };
}
