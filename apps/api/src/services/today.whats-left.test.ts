import { describe, it, expect } from 'vitest';
import { Routine } from '../db/models/Routine.js';
import { TodayPlan } from '../db/models/TodayPlan.js';
import { whatsLeftToday } from './today.js';
import { ymd } from '../utils/dates.js';

async function seedPlanWithItems(
  items: Array<{
    routine_key: string;
    name: string;
    estimate_minutes: number;
    order: number;
    status: 'pending' | 'done';
  }>,
): Promise<void> {
  // Make sure ensureTodayPlan won't trigger a regen by seeding minimal Routine
  // entries the morning-gen path needs.
  await TodayPlan.create({
    date: ymd(new Date()),
    day_type: 'weekday_default',
    budget_minutes: 60,
    current_energy: 'medium',
    items: items.map((i) => ({
      routine_key: i.routine_key,
      name: i.name,
      estimate_minutes: i.estimate_minutes,
      energy: 'low',
      status: i.status,
      order: i.order,
    })),
    swap_pool: [],
    publisher: {},
  });
}

describe('whatsLeftToday', () => {
  it('returns only non-done items in order, summed', async () => {
    await Routine.create({
      key: 'a',
      name: 'A',
      category: 'pet',
      zone: 'bathrooms',
      scheduling: { type: 'rolling', interval_days: 1, flex_days: 0 },
      estimate_minutes: 8,
      energy: 'low',
      active: true,
    });
    await seedPlanWithItems([
      { routine_key: 'a', name: 'Scoop litter', estimate_minutes: 8, order: 1, status: 'pending' },
      { routine_key: 'b', name: 'Trash out', estimate_minutes: 5, order: 2, status: 'done' },
      { routine_key: 'c', name: 'Kitchen reset', estimate_minutes: 12, order: 0, status: 'pending' },
    ]);

    const result = await whatsLeftToday();
    expect(result.items.map((i) => i.name)).toEqual([
      'Kitchen reset',
      'Scoop litter',
    ]);
    expect(result.total_minutes).toBe(20);
  });

  it('returns empty + zero when all items are done', async () => {
    await seedPlanWithItems([
      { routine_key: 'a', name: 'Only', estimate_minutes: 5, order: 0, status: 'done' },
    ]);
    const result = await whatsLeftToday();
    expect(result.items).toEqual([]);
    expect(result.total_minutes).toBe(0);
  });
});
