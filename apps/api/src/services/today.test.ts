import { describe, it, expect, beforeEach } from 'vitest';
import { Routine } from '../db/models/Routine.js';
import { TodayPlan } from '../db/models/TodayPlan.js';
import { ymd } from '../utils/dates.js';
import { swapTask, markDone, pullFromPool } from './today.js';

async function seedPlan() {
  return TodayPlan.create({
    date: ymd(new Date()),
    day_type: 'weekday_default',
    budget_minutes: 45,
    current_energy: 'medium',
    items: [
      {
        routine_key: 'litter_scoop',
        name: 'Litter',
        estimate_minutes: 8,
        energy: 'low',
        status: 'pending',
        order: 0,
      },
      {
        routine_key: 'kitchen_reset',
        name: 'Kitchen reset',
        estimate_minutes: 8,
        energy: 'low',
        status: 'pending',
        order: 1,
      },
    ],
    swap_pool: [
      {
        routine_key: 'mop',
        name: 'Mop floors',
        estimate_minutes: 25,
        energy: 'medium',
        deferred_at: new Date(),
        reason: 'over_budget',
      },
    ],
    publisher: {},
  });
}

beforeEach(async () => {
  await Routine.create({
    key: 'litter_scoop',
    name: 'Litter',
    category: 'pet',
    zone: 'bathrooms',
    scheduling: { type: 'rolling', interval_days: 1, flex_days: 1 },
    estimate_minutes: 8,
    energy: 'low',
    active: true,
  });
});

describe('swapTask', () => {
  it('moves an item to swap_pool with reason=manual_swap', async () => {
    await seedPlan();
    const updated = await swapTask('litter_scoop');
    expect(updated?.items.find((i) => i.routine_key === 'litter_scoop')).toBeUndefined();
    const moved = updated?.swap_pool.find((p) => p.routine_key === 'litter_scoop');
    expect(moved).toBeDefined();
    expect(moved!.reason).toBe('manual_swap');
  });

  it('pulls replacement from swap_pool when key matches', async () => {
    await seedPlan();
    const updated = await swapTask('litter_scoop', 'mop');
    expect(updated?.items.find((i) => i.routine_key === 'mop')).toBeDefined();
    expect(updated?.swap_pool.find((p) => p.routine_key === 'mop')).toBeUndefined();
  });
});

describe('markDone', () => {
  it('sets status=done and bumps Routine.last_done', async () => {
    await seedPlan();
    const before = await Routine.findOne({ key: 'litter_scoop' });
    expect(before?.last_done).toBeFalsy();

    const updated = await markDone('litter_scoop');
    const item = updated?.items.find((i) => i.routine_key === 'litter_scoop');
    expect(item?.status).toBe('done');
    expect(item?.completed_at).toBeTruthy();

    const after = await Routine.findOne({ key: 'litter_scoop' });
    expect(after?.last_done).toBeTruthy();
  });
});

describe('pullFromPool', () => {
  it('moves an item from swap_pool back into items', async () => {
    await seedPlan();
    const updated = await pullFromPool('mop');
    expect(updated?.items.find((i) => i.routine_key === 'mop')).toBeDefined();
    expect(updated?.swap_pool.find((p) => p.routine_key === 'mop')).toBeUndefined();
  });
});
