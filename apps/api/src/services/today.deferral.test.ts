import { describe, it, expect, beforeEach } from 'vitest';
import { Routine } from '../db/models/Routine.js';
import { TodayPlan } from '../db/models/TodayPlan.js';
import { DeferralEvent } from '../db/models/DeferralEvent.js';
import { ymd } from '../utils/dates.js';
import { swapTask } from './today.js';

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
  await TodayPlan.create({
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
    ],
    swap_pool: [],
    publisher: {},
  });
});

describe('swapTask — DeferralEvent persistence', () => {
  it('writes a DeferralEvent with reason=manual_swap by default', async () => {
    await swapTask('litter_scoop');
    const events = await DeferralEvent.find({}).lean();
    expect(events.length).toBe(1);
    expect(events[0]?.routine_key).toBe('litter_scoop');
    expect(events[0]?.reason).toBe('manual_swap');
    expect(events[0]?.source).toBe('user');
  });

  it('records the caller-supplied reason and notes', async () => {
    await swapTask('litter_scoop', undefined, 'tired', 'long day');
    const event = await DeferralEvent.findOne({});
    expect(event?.reason).toBe('tired');
    expect(event?.notes).toBe('long day');
  });

  it('does not write a DeferralEvent if the item is not on the plan', async () => {
    await swapTask('does_not_exist');
    const events = await DeferralEvent.find({}).lean();
    expect(events.length).toBe(0);
  });
});
