import { DeferralEvent } from '../db/models/DeferralEvent.js';
import { WorkoutLog } from '../db/models/WorkoutLog.js';
import { dayOfWeek, ymd } from '../utils/dates.js';
import type {
  DeferralPattern,
  DeferReasonCode,
  WorkoutPattern,
} from '@household-os/shared/types';

/**
 * Routines that have been deferred at least `min` times in the last `days`.
 * Sorted by count desc.
 */
export async function frequentDeferrals(
  days = 14,
  min = 2,
): Promise<DeferralPattern[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const events = await DeferralEvent.find({ ts: { $gte: since } }).lean();

  const grouped = new Map<string, DeferralPattern>();
  for (const e of events) {
    const existing = grouped.get(e.routine_key);
    if (existing) {
      existing.count += 1;
      existing.reasons[e.reason as DeferReasonCode] =
        (existing.reasons[e.reason as DeferReasonCode] ?? 0) + 1;
      if (new Date(e.ts) > new Date(existing.last_deferred_at)) {
        existing.last_deferred_at = e.ts;
      }
    } else {
      grouped.set(e.routine_key, {
        routine_key: e.routine_key,
        routine_name: e.routine_name,
        count: 1,
        window_days: days,
        reasons: { [e.reason as DeferReasonCode]: 1 },
        last_deferred_at: e.ts,
      });
    }
  }

  return Array.from(grouped.values())
    .filter((p) => p.count >= min)
    .sort((a, b) => b.count - a.count);
}

/**
 * Workout completion summary over the last `days`. Counts only weekdays as
 * "scheduled" since the protected-slot inventory doesn't allocate weekend slots.
 */
export async function workoutSummary(days = 14): Promise<WorkoutPattern> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const logs = await WorkoutLog.find({ ts: { $gte: since } })
    .sort({ date: 1 })
    .lean();

  let scheduled = 0;
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const dow = dayOfWeek(d);
    if (dow === 'tue' || dow === 'thu' || dow === 'mon' || dow === 'wed' || dow === 'fri') {
      scheduled += 1;
    }
  }

  const counts = { done: 0, skipped: 0, partial: 0 };
  for (const log of logs) {
    if (log.status === 'done') counts.done += 1;
    else if (log.status === 'skipped') counts.skipped += 1;
    else if (log.status === 'partial') counts.partial += 1;
  }

  // Compute streaks of consecutive done/skipped days (from most recent log
  // backwards).
  const streaks: WorkoutPattern['recent_streaks'] = [];
  let currentKind: 'done' | 'skipped' | null = null;
  let currentLen = 0;
  for (const log of [...logs].reverse()) {
    const kind: 'done' | 'skipped' | null =
      log.status === 'done' ? 'done' : log.status === 'skipped' ? 'skipped' : null;
    if (kind === null) continue;
    if (kind === currentKind) currentLen += 1;
    else {
      if (currentKind && currentLen > 0) {
        streaks.push({ kind: currentKind, length: currentLen });
      }
      currentKind = kind;
      currentLen = 1;
    }
  }
  if (currentKind && currentLen > 0) {
    streaks.push({ kind: currentKind, length: currentLen });
  }

  return {
    window_days: days,
    scheduled,
    done: counts.done,
    skipped: counts.skipped,
    partial: counts.partial,
    recent_streaks: streaks.slice(0, 3),
  };
}

void ymd; // keep import for future date-bucketed queries
