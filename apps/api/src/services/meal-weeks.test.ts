import { describe, it, expect } from 'vitest';
import { ActivityLog } from '../db/models/ActivityLog.js';
import { MealWeek } from '../db/models/MealWeek.js';
import {
  adjacentMealWeeks,
  deleteMealWeek,
  getMealWeek,
  getMealWeekByDate,
  listMealWeeks,
  shiftWeek,
  startOfWeek,
  upsertMealWeek,
} from './meal-weeks.js';

const SAMPLE_MEAL = {
  day: 'Monday, May 11',
  title: 'Pasta with chicken',
  effort: 'cook' as const,
  effort_label: '🍳 Cook',
  time: '~30 min',
  protein: '~45g protein',
  servings: '2 servings',
  ingredients: ['pasta', 'rotisserie chicken'],
  steps: ['boil pasta', 'add chicken'],
};

describe('startOfWeek', () => {
  it('returns the same day for a Monday', () => {
    const mon = new Date(2026, 4, 11); // Mon May 11 2026
    const r = startOfWeek(mon);
    expect(r.getDay()).toBe(1);
    expect(r.getDate()).toBe(11);
  });

  it('walks back to Monday for a Sunday', () => {
    const sun = new Date(2026, 4, 17); // Sun May 17 2026
    const r = startOfWeek(sun);
    expect(r.getDay()).toBe(1);
    expect(r.getDate()).toBe(11);
  });

  it('walks back to Monday for a Wednesday', () => {
    const wed = new Date(2026, 4, 13);
    const r = startOfWeek(wed);
    expect(r.getDate()).toBe(11);
  });
});

describe('shiftWeek', () => {
  it('moves forward by 7 days', () => {
    expect(shiftWeek('2026-05-11', 1)).toBe('2026-05-18');
  });
  it('moves backward by 7 days', () => {
    expect(shiftWeek('2026-05-11', -1)).toBe('2026-05-04');
  });
  it('handles month rollover', () => {
    expect(shiftWeek('2026-04-27', 1)).toBe('2026-05-04');
  });
  it('returns input unchanged for malformed start_date', () => {
    expect(shiftWeek('not-a-date', 1)).toBe('not-a-date');
  });
});

describe('upsertMealWeek', () => {
  it('creates a week and logs meal_week_saved', async () => {
    const result = await upsertMealWeek({
      start_date: '2026-05-11',
      title: 'High-protein week',
      meals: [SAMPLE_MEAL],
    });
    expect(result.start_date).toBe('2026-05-11');
    expect(result.title).toBe('High-protein week');
    expect(result.meals.length).toBe(1);

    const entry = await ActivityLog.findOne({
      kind: 'meal_week_saved',
    }).lean();
    expect(entry).toBeTruthy();
    const meta = entry?.metadata as {
      start_date?: string;
      meal_count?: number;
    };
    expect(meta?.start_date).toBe('2026-05-11');
    expect(meta?.meal_count).toBe(1);
  });

  it('overwrites the existing week (same start_date)', async () => {
    await upsertMealWeek({
      start_date: '2026-05-11',
      meals: [SAMPLE_MEAL],
    });
    await upsertMealWeek({
      start_date: '2026-05-11',
      meals: [SAMPLE_MEAL, { ...SAMPLE_MEAL, day: 'Tuesday' }],
    });
    const all = await MealWeek.find({}).lean();
    expect(all.length).toBe(1);
    expect(all[0]?.meals.length).toBe(2);
  });

  it('rejects bad start_date', async () => {
    await expect(
      upsertMealWeek({
        start_date: 'nope',
        meals: [SAMPLE_MEAL],
      }),
    ).rejects.toThrow(/start_date/);
  });

  it('rejects empty meals array', async () => {
    await expect(
      upsertMealWeek({
        start_date: '2026-05-11',
        meals: [],
      }),
    ).rejects.toThrow(/non-empty/);
  });

  it('rejects meal missing required field', async () => {
    await expect(
      upsertMealWeek({
        start_date: '2026-05-11',
        meals: [{ day: 'Mon', title: 'X' }],
      }),
    ).rejects.toThrow(/required/);
  });

  it('rejects invalid effort value', async () => {
    await expect(
      upsertMealWeek({
        start_date: '2026-05-11',
        meals: [{ ...SAMPLE_MEAL, effort: 'frenetic' as unknown as 'cook' }],
      }),
    ).rejects.toThrow(/effort/);
  });
});

describe('getMealWeek + getMealWeekByDate', () => {
  it('returns null when nothing saved', async () => {
    expect(await getMealWeek('2026-05-11')).toBeNull();
  });

  it('finds by exact start_date', async () => {
    await upsertMealWeek({ start_date: '2026-05-11', meals: [SAMPLE_MEAL] });
    const week = await getMealWeek('2026-05-11');
    expect(week?.start_date).toBe('2026-05-11');
  });

  it('finds the week containing any day in it', async () => {
    await upsertMealWeek({ start_date: '2026-05-11', meals: [SAMPLE_MEAL] });
    // Wed May 13 → Mon May 11 week
    const week = await getMealWeekByDate('2026-05-13');
    expect(week?.start_date).toBe('2026-05-11');
  });

  it('returns null for malformed date', async () => {
    expect(await getMealWeek('not-a-date')).toBeNull();
    expect(await getMealWeekByDate('not-a-date')).toBeNull();
  });
});

describe('adjacentMealWeeks', () => {
  it('returns nearest prev + next, skipping empty Mondays', async () => {
    await upsertMealWeek({ start_date: '2026-04-27', meals: [SAMPLE_MEAL] });
    await upsertMealWeek({ start_date: '2026-05-18', meals: [SAMPLE_MEAL] });
    // Cursor at empty 2026-05-11
    const { prev, next } = await adjacentMealWeeks('2026-05-11');
    expect(prev?.start_date).toBe('2026-04-27');
    expect(next?.start_date).toBe('2026-05-18');
  });

  it('returns null for either side when none exist', async () => {
    await upsertMealWeek({ start_date: '2026-05-11', meals: [SAMPLE_MEAL] });
    const { prev, next } = await adjacentMealWeeks('2026-05-11');
    expect(prev).toBeNull();
    expect(next).toBeNull();
  });
});

describe('listMealWeeks', () => {
  it('returns newest-first', async () => {
    await upsertMealWeek({ start_date: '2026-04-27', meals: [SAMPLE_MEAL] });
    await upsertMealWeek({ start_date: '2026-05-11', meals: [SAMPLE_MEAL] });
    await upsertMealWeek({ start_date: '2026-05-04', meals: [SAMPLE_MEAL] });
    const list = await listMealWeeks();
    expect(list.map((w) => w.start_date)).toEqual([
      '2026-05-11',
      '2026-05-04',
      '2026-04-27',
    ]);
  });
});

describe('deleteMealWeek', () => {
  it('deletes by start_date and returns true', async () => {
    await upsertMealWeek({ start_date: '2026-05-11', meals: [SAMPLE_MEAL] });
    expect(await deleteMealWeek('2026-05-11')).toBe(true);
    expect(await getMealWeek('2026-05-11')).toBeNull();
  });

  it('returns false when nothing was deleted', async () => {
    expect(await deleteMealWeek('2026-05-11')).toBe(false);
  });
});
