import { describe, it, expect } from 'vitest';
import { Routine } from '../db/models/Routine.js';
import { TodayPlan } from '../db/models/TodayPlan.js';
import { Trigger } from '../db/models/Trigger.js';
import { addDays, ymd } from '../utils/dates.js';
import { generateTodayPlan } from './morning-gen.js';

const TODAY = new Date(2026, 4, 12); // Tue 2026-05-12

async function insertRoutine(doc: Record<string, unknown>) {
  return Routine.create({ active: true, ...doc });
}

describe('generateTodayPlan — rolling routines', () => {
  it('schedules a never-done daily routine', async () => {
    await insertRoutine({
      key: 'litter_scoop',
      name: 'Litter',
      category: 'pet',
      zone: 'bathrooms',
      scheduling: { type: 'rolling', interval_days: 1, flex_days: 1 },
      estimate_minutes: 8,
      energy: 'low',
    });

    const { planId } = await generateTodayPlan(TODAY);
    const plan = await TodayPlan.findById(planId);
    expect(plan?.items.find((i) => i.routine_key === 'litter_scoop')).toBeDefined();
  });

  it('skips a rolling routine that is not yet due (within flex window)', async () => {
    await insertRoutine({
      key: 'water_fountain',
      name: 'Cat fountain',
      category: 'pet',
      zone: 'kitchen',
      scheduling: { type: 'rolling', interval_days: 7, flex_days: 3 },
      estimate_minutes: 10,
      energy: 'low',
      last_done: addDays(TODAY, -2), // done 2 days ago, not due
    });

    const { planId } = await generateTodayPlan(TODAY);
    const plan = await TodayPlan.findById(planId);
    expect(plan?.items.find((i) => i.routine_key === 'water_fountain')).toBeUndefined();
  });

  it('schedules an overdue rolling routine', async () => {
    await insertRoutine({
      key: 'litter_full',
      name: 'Full litter change',
      category: 'pet',
      zone: 'bathrooms',
      scheduling: { type: 'rolling', interval_days: 7, flex_days: 2 },
      estimate_minutes: 20,
      energy: 'medium',
      last_done: addDays(TODAY, -10),
    });

    const { planId } = await generateTodayPlan(TODAY);
    const plan = await TodayPlan.findById(planId);
    expect(plan?.items.find((i) => i.routine_key === 'litter_full')).toBeDefined();
  });
});

describe('generateTodayPlan — fixed routines', () => {
  it('schedules a fixed routine on its day_of_week', async () => {
    await insertRoutine({
      key: 'trash_prep',
      name: 'Bins to curb',
      category: 'trash',
      zone: 'whole-house',
      scheduling: { type: 'fixed', day_of_week: 'tue' },
      estimate_minutes: 20,
      energy: 'low',
    });

    const { planId } = await generateTodayPlan(TODAY);
    const plan = await TodayPlan.findById(planId);
    expect(plan?.items.find((i) => i.routine_key === 'trash_prep')).toBeDefined();
  });

  it('does not schedule a fixed routine on the wrong day', async () => {
    await insertRoutine({
      key: 'trash_return',
      name: 'Bins back',
      category: 'trash',
      zone: 'whole-house',
      scheduling: { type: 'fixed', day_of_week: 'wed' },
      estimate_minutes: 5,
      energy: 'low',
    });

    const { planId } = await generateTodayPlan(TODAY); // Tue
    const plan = await TodayPlan.findById(planId);
    expect(plan?.items.find((i) => i.routine_key === 'trash_return')).toBeUndefined();
  });
});

describe('generateTodayPlan — event-driven triggers', () => {
  it('schedules airbnb_pre 1 day before checkin and fans yard_pickup', async () => {
    await insertRoutine({
      key: 'airbnb_pre',
      name: 'Airbnb pre-clean',
      category: 'airbnb',
      zone: 'whole-house',
      scheduling: { type: 'event_driven', trigger: 'airbnb_checkin_minus_1d' },
      estimate_minutes: 60,
      energy: 'high',
      also_triggers: ['yard_pickup'],
    });
    await insertRoutine({
      key: 'yard_pickup',
      name: 'Yard pickup',
      category: 'pet',
      zone: 'yard',
      scheduling: { type: 'rolling', interval_days: 7, flex_days: 2 },
      estimate_minutes: 25,
      energy: 'medium',
      skip_if: 'landscaper_this_week',
    });

    await Trigger.create({
      type: 'airbnb_checkin',
      date: ymd(addDays(TODAY, 1)),
      source: 'manual',
      ingested_at: new Date(),
    });

    const { planId } = await generateTodayPlan(TODAY);
    const plan = await TodayPlan.findById(planId);
    // airbnb_pre is 60 min; weekday budget is 45, so it may land in swap_pool.
    // The point of this test is the trigger fired, not packing — check both.
    const all = [
      ...(plan?.items ?? []).map((i) => i.routine_key),
      ...(plan?.swap_pool ?? []).map((p) => p.routine_key),
    ];
    expect(all).toContain('airbnb_pre');
    expect(all).toContain('yard_pickup');
  });

  it('skips yard_pickup when landscaper is scheduled this week', async () => {
    await insertRoutine({
      key: 'airbnb_pre',
      name: 'Airbnb pre-clean',
      category: 'airbnb',
      zone: 'whole-house',
      scheduling: { type: 'event_driven', trigger: 'airbnb_checkin_minus_1d' },
      estimate_minutes: 60,
      energy: 'high',
      also_triggers: ['yard_pickup'],
    });
    await insertRoutine({
      key: 'yard_pickup',
      name: 'Yard pickup',
      category: 'pet',
      zone: 'yard',
      scheduling: { type: 'rolling', interval_days: 7, flex_days: 2 },
      estimate_minutes: 25,
      energy: 'medium',
      skip_if: 'landscaper_this_week',
    });

    await Trigger.create({
      type: 'airbnb_checkin',
      date: ymd(addDays(TODAY, 1)),
      source: 'manual',
      ingested_at: new Date(),
    });
    await Trigger.create({
      type: 'landscaper',
      date: ymd(addDays(TODAY, 3)),
      source: 'manual',
      ingested_at: new Date(),
    });

    const { planId } = await generateTodayPlan(TODAY);
    const plan = await TodayPlan.findById(planId);
    const all = [
      ...(plan?.items ?? []).map((i) => i.routine_key),
      ...(plan?.swap_pool ?? []).map((p) => p.routine_key),
    ];
    expect(all).toContain('airbnb_pre');
    expect(all).not.toContain('yard_pickup');
  });
});

describe('generateTodayPlan — packing', () => {
  it('overflows items past budget into swap_pool', async () => {
    // Tuesday + PT (no calendar creds) → weekday_default budget = 45
    // Insert 3 rolling routines totaling 90 min; expect overflow.
    for (let i = 0; i < 3; i++) {
      await insertRoutine({
        key: `task_${i}`,
        name: `Task ${i}`,
        category: 'cleaning',
        zone: 'common',
        scheduling: { type: 'rolling', interval_days: 1, flex_days: 0 },
        estimate_minutes: 30,
        energy: 'low',
      });
    }

    const { planId } = await generateTodayPlan(TODAY);
    const plan = await TodayPlan.findById(planId);
    const used = (plan?.items ?? []).reduce(
      (acc, it) => acc + (it.estimate_minutes ?? 0),
      0,
    );
    expect(used).toBeLessThanOrEqual(plan!.budget_minutes);
    expect(plan!.swap_pool.length).toBeGreaterThan(0);
  });

  it('idempotent: regenerating same date does not duplicate', async () => {
    await insertRoutine({
      key: 'litter_scoop',
      name: 'Litter',
      category: 'pet',
      zone: 'bathrooms',
      scheduling: { type: 'rolling', interval_days: 1, flex_days: 1 },
      estimate_minutes: 8,
      energy: 'low',
    });

    const first = await generateTodayPlan(TODAY);
    expect(first.created).toBe(true);
    const second = await generateTodayPlan(TODAY);
    expect(second.created).toBe(false);
    expect(second.planId).toBe(first.planId);
  });
});
