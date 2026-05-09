import { describe, it, expect } from 'vitest';
import { WorkoutLog } from '../db/models/WorkoutLog.js';
import { logWorkout, recentWorkouts, todaysSlot } from './workouts.js';
import { ymd } from '../utils/dates.js';

describe('todaysSlot', () => {
  it('returns pt_tue on Tuesdays', () => {
    const slot = todaysSlot(new Date(2026, 4, 12)); // Tue
    expect(slot?.slot_key).toBe('pt_tue');
  });

  it('returns pt_thu on Thursdays', () => {
    const slot = todaysSlot(new Date(2026, 4, 14)); // Thu
    expect(slot?.slot_key).toBe('pt_thu');
  });

  it('returns lift_flex on flex weekdays (mon/wed/fri)', () => {
    expect(todaysSlot(new Date(2026, 4, 11))?.slot_key).toBe('lift_flex'); // Mon
    expect(todaysSlot(new Date(2026, 4, 13))?.slot_key).toBe('lift_flex'); // Wed
    expect(todaysSlot(new Date(2026, 4, 15))?.slot_key).toBe('lift_flex'); // Fri
  });

  it('returns null on weekends', () => {
    expect(todaysSlot(new Date(2026, 4, 9))).toBeNull();  // Sat
    expect(todaysSlot(new Date(2026, 4, 10))).toBeNull(); // Sun
  });
});

describe('logWorkout', () => {
  it('upserts on (date, slot_key) — second log overwrites first', async () => {
    await logWorkout({ slot_key: 'pt_tue', status: 'done' });
    await logWorkout({ slot_key: 'pt_tue', status: 'partial', notes: 'shorter' });
    const logs = await WorkoutLog.find({ slot_key: 'pt_tue' }).lean();
    expect(logs.length).toBe(1);
    expect(logs[0]?.status).toBe('partial');
    expect(logs[0]?.notes).toBe('shorter');
  });

  it('records mood + energy when provided', async () => {
    await logWorkout({
      slot_key: 'lift_flex',
      status: 'done',
      mood: 'good',
      energy: 'high',
    });
    const log = await WorkoutLog.findOne({ slot_key: 'lift_flex' });
    expect(log?.mood).toBe('good');
    expect(log?.energy).toBe('high');
  });

  it('different dates create distinct rows for the same slot', async () => {
    await logWorkout({ slot_key: 'pt_tue', status: 'done', date: '2026-05-05' });
    await logWorkout({ slot_key: 'pt_tue', status: 'skipped', date: '2026-05-12' });
    const logs = await WorkoutLog.find({ slot_key: 'pt_tue' }).lean();
    expect(logs.length).toBe(2);
  });
});

describe('recentWorkouts', () => {
  it('returns logs within window, sorted by date desc', async () => {
    await logWorkout({ slot_key: 'pt_tue', status: 'done', date: '2026-05-05' });
    await logWorkout({ slot_key: 'pt_thu', status: 'skipped', date: '2026-05-07' });
    const logs = await recentWorkouts(30);
    expect(logs.length).toBe(2);
    // sorted desc — newer one first
    expect(logs[0]?.date).toBe('2026-05-07');
  });

  it('today is included by default', async () => {
    await logWorkout({ slot_key: 'pt_tue', status: 'done', date: ymd(new Date()) });
    const logs = await recentWorkouts();
    expect(logs.length).toBe(1);
  });
});
