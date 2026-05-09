import { describe, it, expect, beforeEach } from 'vitest';
import { ActivityLog } from '../db/models/ActivityLog.js';
import { Routine } from '../db/models/Routine.js';
import { TodayPlan } from '../db/models/TodayPlan.js';
import { ymd } from '../utils/dates.js';
import { markDone, swapTask, pullFromPool } from './today.js';
import { logEnergy } from './energy.js';
import { logMood } from './mood.js';
import { logWorkout } from './workouts.js';
import { recordAssessment, cancelAdHocTask } from './zones.js';
import { addTrigger } from './triggers.js';
import { patchRoutine } from './routines.js';

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
});

describe('action sites write to ActivityLog', () => {
  it('markDone → task_done', async () => {
    await markDone('litter_scoop');
    const events = await ActivityLog.find({ kind: 'task_done' }).lean();
    expect(events.length).toBe(1);
    expect(events[0]?.summary).toContain('Litter');
  });

  it('swapTask without replacement → task_deferred', async () => {
    await swapTask('litter_scoop');
    const events = await ActivityLog.find({ kind: 'task_deferred' }).lean();
    expect(events.length).toBe(1);
  });

  it('swapTask with replacement → task_swapped', async () => {
    await swapTask('litter_scoop', 'mop');
    const events = await ActivityLog.find({ kind: 'task_swapped' }).lean();
    expect(events.length).toBe(1);
    expect(events[0]?.summary).toMatch(/Mop/);
  });

  it('pullFromPool → task_pulled', async () => {
    await pullFromPool('mop');
    const events = await ActivityLog.find({ kind: 'task_pulled' }).lean();
    expect(events.length).toBe(1);
  });

  it('logEnergy → energy_logged', async () => {
    await logEnergy('low');
    const events = await ActivityLog.find({ kind: 'energy_logged' }).lean();
    expect(events.length).toBe(1);
    expect(events[0]?.metadata).toMatchObject({ level: 'low' });
  });

  it('logMood → mood_logged', async () => {
    await logMood('good');
    const events = await ActivityLog.find({ kind: 'mood_logged' }).lean();
    expect(events.length).toBe(1);
  });

  it('logWorkout → workout_logged', async () => {
    await logWorkout({ slot_key: 'pt_tue', status: 'done' });
    const events = await ActivityLog.find({ kind: 'workout_logged' }).lean();
    expect(events.length).toBe(1);
  });

  it('recordAssessment with rough → zone_assessed AND task_created', async () => {
    await recordAssessment('kitchen', 'rough', 'counters');
    const assessed = await ActivityLog.find({ kind: 'zone_assessed' }).lean();
    const created = await ActivityLog.find({ kind: 'task_created' }).lean();
    expect(assessed.length).toBe(1);
    expect(created.length).toBe(1);
    expect(created[0]?.summary).toContain('counters');
  });

  it('recordAssessment with fine → zone_assessed only', async () => {
    await recordAssessment('kitchen', 'fine', undefined);
    const assessed = await ActivityLog.find({ kind: 'zone_assessed' }).lean();
    const created = await ActivityLog.find({ kind: 'task_created' }).lean();
    expect(assessed.length).toBe(1);
    expect(created.length).toBe(0);
  });

  it('cancelAdHocTask → task_cancelled', async () => {
    const { task } = await recordAssessment('yard', 'meh', 'sweep');
    if (!task?._id) throw new Error('expected task');
    await cancelAdHocTask(String(task._id));
    const events = await ActivityLog.find({ kind: 'task_cancelled' }).lean();
    expect(events.length).toBe(1);
  });

  it('addTrigger → trigger_added', async () => {
    await addTrigger({ type: 'airbnb_checkin', date: '2026-05-15' });
    const events = await ActivityLog.find({ kind: 'trigger_added' }).lean();
    expect(events.length).toBe(1);
    expect(events[0]?.summary).toContain('2026-05-15');
  });

  it('patchRoutine → routine_edited', async () => {
    await patchRoutine('litter_scoop', { estimate_minutes: 12 });
    const events = await ActivityLog.find({ kind: 'routine_edited' }).lean();
    expect(events.length).toBe(1);
    expect(events[0]?.metadata).toMatchObject({ fields: ['estimate_minutes'] });
  });
});
