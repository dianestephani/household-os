import { describe, it, expect } from 'vitest';
import { CheckIn } from '../db/models/CheckIn.js';
import { DeferralEvent } from '../db/models/DeferralEvent.js';
import { WorkoutLog } from '../db/models/WorkoutLog.js';
import {
  generateEveningRetro,
  generateMorningIntent,
  generatePatternInterrupts,
  generateWeeklyReview,
} from './checkin-generators.js';

describe('generateMorningIntent', () => {
  it('creates a morning_intent CheckIn with one_thing/energy/mood questions', async () => {
    await generateMorningIntent();
    const all = await CheckIn.find({ type: 'morning_intent' }).lean();
    expect(all.length).toBe(1);
    const ids = (all[0]?.questions ?? []).map((q) => q.id);
    expect(ids).toContain('one_thing_today');
    expect(ids).toContain('energy');
    expect(ids).toContain('mood');
  });

  it('is idempotent for the same calendar day', async () => {
    await generateMorningIntent();
    await generateMorningIntent();
    const all = await CheckIn.find({ type: 'morning_intent' }).lean();
    expect(all.length).toBe(1);
  });
});

describe('generateEveningRetro', () => {
  it('creates evening_retro with what_skipped + tomorrow_adjust', async () => {
    await generateEveningRetro();
    const all = await CheckIn.find({ type: 'evening_retro' }).lean();
    expect(all.length).toBe(1);
    const ids = (all[0]?.questions ?? []).map((q) => q.id);
    expect(ids).toContain('what_skipped');
    expect(ids).toContain('tomorrow_adjust');
  });
});

describe('generateWeeklyReview', () => {
  it('embeds a readonly summary + routines_working + cadence_adjust', async () => {
    await generateWeeklyReview();
    const ck = await CheckIn.findOne({ type: 'weekly_review' }).lean();
    const ids = (ck?.questions ?? []).map((q) => q.id);
    expect(ids).toContain('weekly_summary');
    expect(ids).toContain('routines_working');
    expect(ids).toContain('cadence_adjust');
  });
});

describe('generatePatternInterrupts — frequent deferrals', () => {
  it('creates an interrupt when a routine has >= 3 deferrals in 14 days', async () => {
    for (let i = 0; i < 3; i++) {
      await DeferralEvent.create({
        ts: new Date(),
        date: '2026-05-01',
        routine_key: 'yard_pickup',
        routine_name: 'Yard pickup',
        reason: 'tired',
        source: 'user',
      });
    }
    const created = await generatePatternInterrupts();
    expect(created.length).toBe(1);
    const ck = await CheckIn.findOne({ type: 'pattern_interrupt' }).lean();
    expect(ck?.context?.kind).toBe('frequent_deferral');
    expect(ck?.context?.routine_key).toBe('yard_pickup');
    expect(ck?.context?.count).toBe(3);
  });

  it('is idempotent within the same day per routine', async () => {
    for (let i = 0; i < 3; i++) {
      await DeferralEvent.create({
        ts: new Date(),
        date: '2026-05-01',
        routine_key: 'yard_pickup',
        routine_name: 'Yard pickup',
        reason: 'tired',
        source: 'user',
      });
    }
    await generatePatternInterrupts();
    await generatePatternInterrupts();
    const all = await CheckIn.find({
      type: 'pattern_interrupt',
      'context.routine_key': 'yard_pickup',
    }).lean();
    expect(all.length).toBe(1);
  });

  it('skips routines with < 3 deferrals', async () => {
    await DeferralEvent.create({
      ts: new Date(),
      date: '2026-05-01',
      routine_key: 'mop',
      routine_name: 'Mop',
      reason: 'tired',
      source: 'user',
    });
    const created = await generatePatternInterrupts();
    expect(created.length).toBe(0);
  });
});

describe('generatePatternInterrupts — missed workouts', () => {
  it('creates an interrupt on a workout day when streak is >= 2 skipped', async () => {
    // Tuesday → pt_tue is the slot.
    const tuesday = new Date(2026, 4, 12);
    await WorkoutLog.create({
      ts: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
      date: '2026-05-08',
      slot_key: 'pt_thu',
      status: 'skipped',
    });
    await WorkoutLog.create({
      ts: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      date: '2026-05-10',
      slot_key: 'lift_flex',
      status: 'skipped',
    });
    const created = await generatePatternInterrupts(tuesday);
    const interrupt = await CheckIn.findOne({
      type: 'pattern_interrupt',
      'context.kind': 'missed_workouts',
    }).lean();
    expect(created.length).toBe(1);
    expect(interrupt).toBeTruthy();
  });

  it('does not create a workout interrupt on a non-workout day', async () => {
    const saturday = new Date(2026, 4, 9);
    await WorkoutLog.create({
      ts: new Date(),
      date: '2026-05-08',
      slot_key: 'pt_thu',
      status: 'skipped',
    });
    await WorkoutLog.create({
      ts: new Date(),
      date: '2026-05-07',
      slot_key: 'lift_flex',
      status: 'skipped',
    });
    const created = await generatePatternInterrupts(saturday);
    const interrupt = await CheckIn.findOne({
      type: 'pattern_interrupt',
      'context.kind': 'missed_workouts',
    }).lean();
    expect(created.length).toBe(0);
    expect(interrupt).toBeNull();
  });
});
