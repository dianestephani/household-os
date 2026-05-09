import { describe, it, expect } from 'vitest';
import { DeferralEvent } from '../db/models/DeferralEvent.js';
import { WorkoutLog } from '../db/models/WorkoutLog.js';
import { frequentDeferrals, workoutSummary } from './patterns.js';

describe('frequentDeferrals', () => {
  it('groups by routine_key and counts events', async () => {
    await DeferralEvent.create({
      ts: new Date(),
      date: '2026-05-01',
      routine_key: 'yard_pickup',
      routine_name: 'Yard pickup',
      reason: 'tired',
      source: 'user',
    });
    await DeferralEvent.create({
      ts: new Date(),
      date: '2026-05-03',
      routine_key: 'yard_pickup',
      routine_name: 'Yard pickup',
      reason: 'out_of_time',
      source: 'user',
    });
    await DeferralEvent.create({
      ts: new Date(),
      date: '2026-05-05',
      routine_key: 'yard_pickup',
      routine_name: 'Yard pickup',
      reason: 'tired',
      source: 'user',
    });

    const patterns = await frequentDeferrals(14, 2);
    expect(patterns.length).toBe(1);
    expect(patterns[0]?.routine_key).toBe('yard_pickup');
    expect(patterns[0]?.count).toBe(3);
    expect(patterns[0]?.reasons.tired).toBe(2);
    expect(patterns[0]?.reasons.out_of_time).toBe(1);
  });

  it('respects min threshold', async () => {
    await DeferralEvent.create({
      ts: new Date(),
      date: '2026-05-01',
      routine_key: 'mop',
      routine_name: 'Mop',
      reason: 'tired',
      source: 'user',
    });
    const patterns = await frequentDeferrals(14, 2);
    expect(patterns.length).toBe(0);
  });

  it('excludes events outside the window', async () => {
    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await DeferralEvent.create({
      ts: old,
      date: '2026-04-08',
      routine_key: 'litter_full',
      routine_name: 'Full litter',
      reason: 'tired',
      source: 'user',
    });
    await DeferralEvent.create({
      ts: old,
      date: '2026-04-09',
      routine_key: 'litter_full',
      routine_name: 'Full litter',
      reason: 'tired',
      source: 'user',
    });
    const patterns = await frequentDeferrals(14, 2);
    expect(patterns.length).toBe(0);
  });
});

describe('workoutSummary', () => {
  it('counts done/skipped/partial across the window', async () => {
    await WorkoutLog.create({ ts: new Date(), date: '2026-05-05', slot_key: 'pt_tue', status: 'done' });
    await WorkoutLog.create({ ts: new Date(), date: '2026-05-07', slot_key: 'pt_thu', status: 'skipped' });
    await WorkoutLog.create({ ts: new Date(), date: '2026-05-08', slot_key: 'lift_flex', status: 'partial' });
    const summary = await workoutSummary(14);
    expect(summary.done).toBe(1);
    expect(summary.skipped).toBe(1);
    expect(summary.partial).toBe(1);
    expect(summary.scheduled).toBeGreaterThan(0);
  });
});
