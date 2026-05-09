import { CheckIn } from '../db/models/CheckIn.js';
import { logEnergy } from './energy.js';
import { logMood } from './mood.js';
import { recordAssessment } from './zones.js';
import { logActivity } from './activity.js';
import type {
  CheckInContext,
  CheckInQuestion,
  CheckInType,
  EnergyLevel,
  MoodLevel,
  Zone,
  ZoneStateLevel,
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
  context?: CheckInContext;
}) {
  const created = await CheckIn.create({
    type: input.type,
    scheduled_for: input.scheduled_for,
    status: 'pending',
    questions: input.questions,
    context: input.context,
    created_at: new Date(),
  });
  await logActivity('check_in_created', `Check-in created: ${input.type}`, {
    actor: 'cron',
    metadata: { type: input.type, checkin_id: created.id },
  });
  return created;
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
    zone_assessment: 2,
    evening_retro: 3,
    weekly_review: 4,
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

  if (checkin.type === 'zone_assessment' && checkin.context?.kind === 'zone_assessment') {
    const level = checkin.questions.find((q) => q.id === 'zone_state')?.answer as
      | ZoneStateLevel
      | undefined;
    const notes = checkin.questions.find((q) => q.id === 'zone_notes')?.answer ?? undefined;
    if (level) {
      await recordAssessment(
        checkin.context.zone as Zone,
        level,
        notes ?? undefined,
        checkin.id,
      );
    }
  }

  checkin.status = 'answered';
  checkin.answered_at = new Date();
  await checkin.save();
  await logActivity('check_in_answered', `Answered ${checkin.type} check-in`, {
    metadata: { type: checkin.type, checkin_id: checkin.id },
  });
  return checkin.toObject();
}

export async function skipCheckIn(id: string) {
  const checkin = await CheckIn.findById(id);
  if (!checkin) return null;
  checkin.status = 'skipped';
  checkin.answered_at = new Date();
  await checkin.save();
  await logActivity('check_in_skipped', `Skipped ${checkin.type} check-in`, {
    metadata: { type: checkin.type, checkin_id: checkin.id },
  });
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
