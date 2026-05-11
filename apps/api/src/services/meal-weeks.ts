import { MealWeek } from '../db/models/MealWeek.js';
import { logActivity } from './activity.js';
import type {
  MealDay,
  MealEffort,
  MealWeek as MealWeekType,
} from '@household-os/shared/types';

/**
 * Meal week storage. Source of meals is the Grocery Manager persona on
 * claude.ai — Diane pastes a JSON block produced there into the dashboard's
 * Food tab, which POSTs here. Pure storage + retrieval; no derivation,
 * no automatic generation.
 */

const VALID_EFFORTS: readonly MealEffort[] = ['cook', 'easy', 'grab'] as const;

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Returns the Monday of the local week containing `date`. Mondays return
 * themselves. Pure — does not touch the DB.
 */
export function startOfWeek(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  // getDay: Sun=0, Mon=1, ... Sat=6. Convert to days since Monday.
  const daysSinceMonday = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - daysSinceMonday);
  return d;
}

export function shiftWeek(startDate: string, weeks: number): string {
  const [y, m, d] = startDate.split('-').map(Number);
  if (!y || !m || !d) return startDate;
  const dt = new Date(y, m - 1, d + weeks * 7);
  return ymd(dt);
}

function isYmd(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function normalizeMeal(input: unknown): MealDay {
  if (!input || typeof input !== 'object') {
    throw new Error('meal entry must be an object');
  }
  const m = input as Record<string, unknown>;
  const required = ['day', 'title', 'effort', 'effort_label', 'time', 'protein', 'servings'];
  for (const f of required) {
    if (typeof m[f] !== 'string' || !(m[f] as string).trim()) {
      throw new Error(`meal field "${f}" required`);
    }
  }
  const effort = m.effort as string;
  if (!VALID_EFFORTS.includes(effort as MealEffort)) {
    throw new Error(`meal.effort must be one of ${VALID_EFFORTS.join(' / ')}`);
  }
  const ingredients = Array.isArray(m.ingredients) ? m.ingredients.map(String) : [];
  const steps = Array.isArray(m.steps) ? m.steps.map(String) : [];
  return {
    day: (m.day as string).trim(),
    title: (m.title as string).trim(),
    effort: effort as MealEffort,
    effort_label: (m.effort_label as string).trim(),
    time: (m.time as string).trim(),
    protein: (m.protein as string).trim(),
    servings: (m.servings as string).trim(),
    note:
      typeof m.note === 'string' && m.note.trim() ? m.note.trim() : undefined,
    ingredients,
    steps,
  };
}

export interface UpsertMealWeekInput {
  start_date: string;
  title?: string;
  meals: unknown[];
}

export async function upsertMealWeek(
  input: UpsertMealWeekInput,
): Promise<MealWeekType> {
  if (!isYmd(input.start_date)) {
    throw new Error('start_date must be YYYY-MM-DD');
  }
  if (!Array.isArray(input.meals) || input.meals.length === 0) {
    throw new Error('meals must be a non-empty array');
  }
  const meals = input.meals.map(normalizeMeal);

  // We don't strictly require 7 — accept whatever GM produced, the UI
  // renders by index. Most real weeks will be 7.
  // $set must NOT include start_date — it's the upsert key and lives in the
  // filter + $setOnInsert. Mongoose throws "would create a conflict" otherwise.
  const set: Record<string, unknown> = { meals };
  if (typeof input.title === 'string' && input.title.trim()) {
    set.title = input.title.trim();
  } else {
    set.title = undefined;
  }

  const doc = await MealWeek.findOneAndUpdate(
    { start_date: input.start_date },
    { $set: set, $setOnInsert: { start_date: input.start_date } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();

  await logActivity('meal_week_saved', `Saved meal week ${input.start_date}`, {
    metadata: {
      start_date: input.start_date,
      meal_count: meals.length,
    },
  });

  return doc as unknown as MealWeekType;
}

export async function getMealWeek(
  startDate: string,
): Promise<MealWeekType | null> {
  if (!isYmd(startDate)) return null;
  const doc = await MealWeek.findOne({ start_date: startDate }).lean();
  return (doc as unknown as MealWeekType) ?? null;
}

/** Finds the meal week containing a specific date (any day of the week). */
export async function getMealWeekByDate(
  date: string,
): Promise<MealWeekType | null> {
  if (!isYmd(date)) return null;
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return null;
  const start = ymd(startOfWeek(new Date(y, m - 1, d)));
  return getMealWeek(start);
}

export async function listMealWeeks(limit = 26): Promise<MealWeekType[]> {
  const docs = await MealWeek.find({})
    .sort({ start_date: -1 })
    .limit(Math.max(1, Math.min(limit, 200)))
    .lean();
  return docs as unknown as MealWeekType[];
}

/**
 * Returns the closest stored weeks adjacent to `startDate`, so the dashboard
 * nav can hop straight to real data and skip empty Mondays. Either side may
 * be null.
 */
export async function adjacentMealWeeks(startDate: string): Promise<{
  prev: MealWeekType | null;
  next: MealWeekType | null;
}> {
  if (!isYmd(startDate)) return { prev: null, next: null };
  const [prev, next] = await Promise.all([
    MealWeek.findOne({ start_date: { $lt: startDate } })
      .sort({ start_date: -1 })
      .lean(),
    MealWeek.findOne({ start_date: { $gt: startDate } })
      .sort({ start_date: 1 })
      .lean(),
  ]);
  return {
    prev: (prev as unknown as MealWeekType) ?? null,
    next: (next as unknown as MealWeekType) ?? null,
  };
}

export async function deleteMealWeek(startDate: string): Promise<boolean> {
  if (!isYmd(startDate)) return false;
  const res = await MealWeek.deleteOne({ start_date: startDate });
  return (res.deletedCount ?? 0) > 0;
}
