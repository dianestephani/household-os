import { CheckIn } from '../db/models/CheckIn.js';
import { logEnergy } from './energy.js';
import { logMood } from './mood.js';
import type {
  CheckInQuestion,
  CheckInType,
  EnergyLevel,
  MoodLevel,
  PatternInterruptContext,
} from '@household-os/shared/types';

/**
 * How long a pending CheckIn stays answerable before being marked expired.
 * Morning intent at 7am expires at next 7am — keeps the dashboard banner from
 * stacking up stale prompts.
 */
const EXPIRY_HOURS = 24;

export async function createCheckIn(input: {
  type: CheckInType;
  scheduled_for: Date;
  questions: CheckInQuestion[];
  context?: PatternInterruptContext;
}) {
  return CheckIn.create({
    type: input.type,
    scheduled_for: input.scheduled_for,
    status: 'pending',
    questions: input.questions,
    context: input.context,
    created_at: new Date(),
  });
}

/**
 * List pending check-ins, in priority order: pattern_interrupt > morning_intent
 * > evening_retro > weekly_review. Within a type, oldest first.
 */
export async function listPendingCheckIns() {
  await expireOld();
  const order: Record<CheckInType, number> = {
    pattern_interrupt: 0,
    morning_intent: 1,
    evening_retro: 2,
    weekly_review: 3,
  };
  const pending = await CheckIn.find({ status: 'pending' }).lean();
  return pending.sort((a, b) => {
    const oa = order[a.type as CheckInType] ?? 99;
    const ob = order[b.type as CheckInType] ?? 99;
    if (oa !== ob) return oa - ob;
    return new Date(a.scheduled_for).getTime() - new Date(b.scheduled_for).getTime();
  });
}

export async function recentCheckIns(days = 14) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return CheckIn.find({ scheduled_for: { $gte: since } })
    .sort({ scheduled_for: -1 })
    .lean();
}

export async function answerCheckIn(
  id: string,
  answers: Record<string, string>,
) {
  const checkin = await CheckIn.findById(id);
  if (!checkin) return null;

  for (const q of checkin.questions) {
    const value = answers[q.id];
    if (value == null || value === '') continue;
    q.answer = value;

    if (q.side_effect === 'log_mood') {
      await logMood(value as MoodLevel, 'dashboard');
    } else if (q.side_effect === 'log_energy') {
      await logEnergy(value as EnergyLevel, 'dashboard');
    }
  }

  checkin.status = 'answered';
  checkin.answered_at = new Date();
  await checkin.save();
  return checkin.toObject();
}

export async function skipCheckIn(id: string) {
  const checkin = await CheckIn.findById(id);
  if (!checkin) return null;
  checkin.status = 'skipped';
  checkin.answered_at = new Date();
  await checkin.save();
  return checkin.toObject();
}

/**
 * Mark any pending check-ins past their expiry window as `expired`. Called
 * defensively before listing pending so the banner never shows stale prompts.
 */
export async function expireOld() {
  const cutoff = new Date(Date.now() - EXPIRY_HOURS * 60 * 60 * 1000);
  await CheckIn.updateMany(
    { status: 'pending', scheduled_for: { $lt: cutoff } },
    { $set: { status: 'expired' } },
  );
}
