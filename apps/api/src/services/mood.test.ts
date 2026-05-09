import { describe, it, expect } from 'vitest';
import { MoodLog } from '../db/models/MoodLog.js';
import { logMood, recentMoods } from './mood.js';

describe('mood service', () => {
  it('logs a mood entry with default source=dashboard', async () => {
    await logMood('good');
    const all = await MoodLog.find({}).lean();
    expect(all.length).toBe(1);
    expect(all[0]?.level).toBe('good');
    expect(all[0]?.source).toBe('dashboard');
  });

  it('preserves caller-supplied source', async () => {
    await logMood('down', 'voice');
    const log = await MoodLog.findOne({});
    expect(log?.source).toBe('voice');
  });

  it('returns recent moods sorted newest-first', async () => {
    await logMood('down');
    await new Promise((r) => setTimeout(r, 5));
    await logMood('good');
    const moods = await recentMoods();
    expect(moods.map((m) => m.level)).toEqual(['good', 'down']);
  });
});
