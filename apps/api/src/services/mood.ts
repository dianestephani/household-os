import { MoodLog } from '../db/models/MoodLog.js';
import { logActivity } from './activity.js';
import type { MoodLevel, WellbeingSource } from '@household-os/shared/types';

export async function logMood(
  level: MoodLevel,
  source: WellbeingSource = 'dashboard',
) {
  const log = await MoodLog.create({ level, source, ts: new Date() });
  await logActivity('mood_logged', `Mood: ${level}`, {
    actor: source === 'cron-default' ? 'cron' : 'user',
    metadata: { level, source },
  });
  return log;
}

export async function recentMoods(days = 14) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return MoodLog.find({ ts: { $gte: since } })
    .sort({ ts: -1 })
    .lean();
}
