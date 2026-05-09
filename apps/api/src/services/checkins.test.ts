import { describe, it, expect } from 'vitest';
import { CheckIn } from '../db/models/CheckIn.js';
import { EnergyLog } from '../db/models/EnergyLog.js';
import { MoodLog } from '../db/models/MoodLog.js';
import {
  answerCheckIn,
  createCheckIn,
  expireOld,
  listPendingCheckIns,
  recentCheckIns,
  skipCheckIn,
} from './checkins.js';

async function seed(type = 'morning_intent') {
  return createCheckIn({
    type: type as 'morning_intent',
    scheduled_for: new Date(),
    questions: [
      { id: 'one_thing_today', text: 'one thing?', type: 'text' },
      {
        id: 'energy',
        text: 'energy?',
        type: 'energy',
        choices: [
          { value: 'low', label: 'low' },
          { value: 'medium', label: 'medium' },
          { value: 'high', label: 'high' },
        ],
        side_effect: 'log_energy',
      },
      {
        id: 'mood',
        text: 'mood?',
        type: 'mood',
        choices: [
          { value: 'good', label: 'good' },
          { value: 'neutral', label: 'neutral' },
          { value: 'down', label: 'down' },
        ],
        side_effect: 'log_mood',
      },
    ],
  });
}

describe('answerCheckIn', () => {
  it('records each answer onto the matching question', async () => {
    const ck = await seed();
    const result = await answerCheckIn(ck.id, {
      one_thing_today: 'finish PR',
      energy: 'high',
      mood: 'good',
    });
    expect(result?.status).toBe('answered');
    const persisted = await CheckIn.findById(ck.id).lean();
    const ans = Object.fromEntries(
      (persisted?.questions ?? []).map((q) => [q.id, q.answer]),
    );
    expect(ans.one_thing_today).toBe('finish PR');
    expect(ans.energy).toBe('high');
    expect(ans.mood).toBe('good');
  });

  it('routes side_effect=log_energy into EnergyLog', async () => {
    const ck = await seed();
    await answerCheckIn(ck.id, { energy: 'low' });
    const logs = await EnergyLog.find({}).lean();
    expect(logs.length).toBe(1);
    expect(logs[0]?.level).toBe('low');
  });

  it('routes side_effect=log_mood into MoodLog', async () => {
    const ck = await seed();
    await answerCheckIn(ck.id, { mood: 'down' });
    const logs = await MoodLog.find({}).lean();
    expect(logs.length).toBe(1);
    expect(logs[0]?.level).toBe('down');
  });

  it('skips missing/empty answers without crashing', async () => {
    const ck = await seed();
    const res = await answerCheckIn(ck.id, { one_thing_today: '' });
    expect(res?.status).toBe('answered');
    const moods = await MoodLog.find({}).lean();
    const energy = await EnergyLog.find({}).lean();
    expect(moods.length).toBe(0);
    expect(energy.length).toBe(0);
  });

  it('returns null for unknown id', async () => {
    const res = await answerCheckIn('507f1f77bcf86cd799439011', { mood: 'good' });
    expect(res).toBeNull();
  });
});

describe('skipCheckIn', () => {
  it('marks status=skipped', async () => {
    const ck = await seed();
    const res = await skipCheckIn(ck.id);
    expect(res?.status).toBe('skipped');
  });
});

describe('listPendingCheckIns', () => {
  it('orders pattern_interrupt → morning_intent → evening_retro → weekly_review', async () => {
    await createCheckIn({
      type: 'weekly_review',
      scheduled_for: new Date(),
      questions: [],
    });
    await createCheckIn({
      type: 'evening_retro',
      scheduled_for: new Date(),
      questions: [],
    });
    await createCheckIn({
      type: 'morning_intent',
      scheduled_for: new Date(),
      questions: [],
    });
    await createCheckIn({
      type: 'pattern_interrupt',
      scheduled_for: new Date(),
      questions: [],
    });

    const pending = await listPendingCheckIns();
    expect(pending.map((c) => c.type)).toEqual([
      'pattern_interrupt',
      'morning_intent',
      'evening_retro',
      'weekly_review',
    ]);
  });

  it('excludes answered and skipped', async () => {
    const a = await seed();
    const b = await seed();
    await answerCheckIn(a.id, { mood: 'good' });
    await skipCheckIn(b.id);
    const pending = await listPendingCheckIns();
    expect(pending.length).toBe(0);
  });
});

describe('expireOld', () => {
  it('marks pending check-ins past 24h as expired', async () => {
    const old = new Date(Date.now() - 30 * 60 * 60 * 1000); // 30h ago
    await createCheckIn({
      type: 'morning_intent',
      scheduled_for: old,
      questions: [],
    });
    await expireOld();
    const stale = await CheckIn.findOne({ scheduled_for: old }).lean();
    expect(stale?.status).toBe('expired');
  });

  it('leaves recent pending check-ins alone', async () => {
    await seed();
    await expireOld();
    const pending = await CheckIn.find({ status: 'pending' }).lean();
    expect(pending.length).toBe(1);
  });
});

describe('recentCheckIns', () => {
  it('returns within window, newest first', async () => {
    await seed('morning_intent');
    await seed('evening_retro');
    const recent = await recentCheckIns(7);
    expect(recent.length).toBe(2);
  });
});
