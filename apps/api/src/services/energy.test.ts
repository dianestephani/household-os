import { describe, it, expect } from 'vitest';
import { TodayPlan } from '../db/models/TodayPlan.js';
import { ymd } from '../utils/dates.js';
import { suggestSwaps } from './energy.js';

async function seedPlan() {
  return TodayPlan.create({
    date: ymd(new Date()),
    day_type: 'weekday_default',
    budget_minutes: 45,
    current_energy: 'medium',
    items: [
      {
        routine_key: 'low_a',
        name: 'Low task A',
        estimate_minutes: 8,
        energy: 'low',
        status: 'pending',
        order: 0,
      },
      {
        routine_key: 'med_a',
        name: 'Medium task',
        estimate_minutes: 20,
        energy: 'medium',
        status: 'pending',
        order: 1,
      },
      {
        routine_key: 'high_a',
        name: 'High task',
        estimate_minutes: 60,
        energy: 'high',
        status: 'pending',
        order: 2,
      },
    ],
    swap_pool: [
      {
        routine_key: 'low_pool',
        name: 'Low pool task',
        estimate_minutes: 10,
        energy: 'low',
        deferred_at: new Date(),
        reason: 'over_budget',
      },
      {
        routine_key: 'high_pool',
        name: 'High pool task',
        estimate_minutes: 60,
        energy: 'high',
        deferred_at: new Date(),
        reason: 'over_budget',
      },
    ],
    publisher: {},
  });
}

describe('suggestSwaps', () => {
  it('low energy: drops medium + high items, pulls in low pool', async () => {
    await seedPlan();
    const s = await suggestSwaps('low');
    const out = s.suggested_swaps_out.map((i) => i.routine_key);
    const into = s.suggested_swaps_in.map((i) => i.routine_key);
    expect(out).toContain('med_a');
    expect(out).toContain('high_a');
    expect(out).not.toContain('low_a');
    expect(into).toContain('low_pool');
    expect(into).not.toContain('high_pool');
  });

  it('medium energy: drops only high, allows low + medium pool', async () => {
    await seedPlan();
    const s = await suggestSwaps('medium');
    const out = s.suggested_swaps_out.map((i) => i.routine_key);
    const into = s.suggested_swaps_in.map((i) => i.routine_key);
    expect(out).toContain('high_a');
    expect(out).not.toContain('med_a');
    expect(into).toContain('low_pool');
    expect(into).not.toContain('high_pool');
  });

  it('high energy: drops nothing, can pull anything', async () => {
    await seedPlan();
    const s = await suggestSwaps('high');
    expect(s.suggested_swaps_out).toEqual([]);
    const into = s.suggested_swaps_in.map((i) => i.routine_key);
    expect(into).toContain('low_pool');
    expect(into).toContain('high_pool');
  });

  it('returns empty result when no plan exists', async () => {
    const s = await suggestSwaps('low');
    expect(s.suggested_swaps_in).toEqual([]);
    expect(s.suggested_swaps_out).toEqual([]);
  });
});
