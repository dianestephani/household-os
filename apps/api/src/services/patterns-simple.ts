import { MorningCheckin } from '../db/models/MorningCheckin.js';
import { WorkoutLog } from '../db/models/WorkoutLog.js';
import { ymd } from '../utils/dates.js';
import type {
  AwakenessLevel,
  MoodLevel,
} from '@household-os/shared/types';

/**
 * §50 Phase D — small, on-demand pattern surfacer for the Look Back view.
 *
 * Phase D ships two detectors:
 *   1. Workout skips correlated with awakeness  (the §50 example)
 *   2. Consecutive low-mood mornings
 *
 * Pure observation — no recommendation, no scoring. Detectors return `null`
 * when there's not enough signal (typically when the sample size is below
 * threshold or the correlation isn't clean). The route layer filters nulls
 * before sending to the dashboard, and the dashboard hides the section
 * entirely when the array is empty.
 *
 * No cron — computed on demand. Cheap reads against MorningCheckin +
 * WorkoutLog (≤90 days at worst). Adding more detectors in the future:
 * write a new private function, append to `detectPatterns`.
 */

export interface Pattern {
  /** Stable id for the kind of pattern; the dashboard can format per-kind. */
  kind: 'workout_skip_by_awakeness' | 'consecutive_low_mood';
  /** Human-readable, ready to render as-is. Ends with a period. */
  observation: string;
  /** Optional structured payload — useful for downstream consumers / debug. */
  details: Record<string, unknown>;
}

/** Default lookback window. Workout-skip pattern uses this; low-mood uses 14. */
const DEFAULT_WINDOW_DAYS = 30;
const LOW_MOOD_WINDOW_DAYS = 14;

/**
 * Orchestrator — runs every detector, drops nulls, returns the patterns
 * worth surfacing. The dashboard hides the whole section if this returns
 * `[]`, so "no patterns today" is a clean state with no empty boxes.
 */
export async function detectPatterns(
  windowDays = DEFAULT_WINDOW_DAYS,
): Promise<Pattern[]> {
  const safeDays = Math.max(1, Math.min(Math.floor(windowDays || DEFAULT_WINDOW_DAYS), 90));
  const out: Pattern[] = [];

  const skipPattern = await skippedWorkoutsByAwakeness(safeDays);
  if (skipPattern) out.push(skipPattern);

  const lowMood = await consecutiveLowMood(LOW_MOOD_WINDOW_DAYS);
  if (lowMood) out.push(lowMood);

  return out;
}

/**
 * Pattern 1 — "In the last N days, you skipped X workouts — all on groggy
 * mornings." Threshold: ≥2 skips and one awakeness level accounts for ≥75%
 * of them. If the matched skips also have a matching morning check-in for
 * the same date, we can cross-correlate; skips without a same-day check-in
 * are dropped from the denominator (insufficient signal).
 */
export async function skippedWorkoutsByAwakeness(
  windowDays: number,
): Promise<Pattern | null> {
  const skips = await skippedWorkouts(windowDays);
  if (skips.length < 2) return null;

  // Pull the morning check-ins for the dates we care about.
  const dates = Array.from(new Set(skips.map((s) => s.date)));
  const checkins = await MorningCheckin.find({
    date: { $in: dates },
  }).lean();
  const byDate = new Map(checkins.map((c) => [c.date, c]));

  // Bucket skips by the awakeness reported that morning. Skips on days with
  // no check-in are excluded from the math — we can't draw a correlation
  // without it.
  const buckets = new Map<AwakenessLevel, number>();
  let observed = 0;
  for (const s of skips) {
    const c = byDate.get(s.date);
    if (!c) continue;
    observed += 1;
    const key = c.awakeness as AwakenessLevel;
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  if (observed < 2) return null;

  // Find the dominant bucket; require it to cover ≥75% of observed skips.
  let topKey: AwakenessLevel | null = null;
  let topCount = 0;
  for (const [k, count] of buckets) {
    if (count > topCount) {
      topCount = count;
      topKey = k;
    }
  }
  if (!topKey) return null;
  const ratio = topCount / observed;
  if (ratio < 0.75) return null;

  const allOrMost = topCount === observed ? 'all' : `${topCount} of ${observed}`;
  const ago = `the last ${windowDays} days`;
  const verb = topCount === 1 ? 'was' : 'were';
  const noun = topCount === 1 ? 'workout' : 'workouts';
  const observation =
    topCount === observed
      ? `In ${ago}, you skipped ${observed} ${noun} — all on ${topKey} mornings.`
      : `In ${ago}, ${allOrMost} skipped ${noun} ${verb} on ${topKey} mornings.`;

  return {
    kind: 'workout_skip_by_awakeness',
    observation,
    details: {
      window_days: windowDays,
      skips_observed: observed,
      total_skips_in_window: skips.length,
      awakeness: topKey,
      matching_skips: topCount,
      ratio,
    },
  };
}

/**
 * Pattern 2 — "3+ consecutive days of low mood in the last N days." Surfaces
 * only when there's a run of ≥3 days with mood='down' in a row, working back
 * from today. Single-day dips don't qualify — we're trying to spot trends
 * Diane can introspect on, not flag every bad day.
 */
export async function consecutiveLowMood(
  windowDays: number,
): Promise<Pattern | null> {
  const checkins = await recentCheckinsByDate(windowDays);
  if (checkins.length === 0) return null;

  // Walk newest → oldest, count the leading run of 'down' mood entries.
  // Allow gaps (days with no check-in) to NOT break the run — we don't
  // assume "no log = bad day."
  let run = 0;
  for (const c of checkins) {
    if (c.mood === 'down') {
      run += 1;
    } else {
      break;
    }
  }

  if (run < 3) return null;

  return {
    kind: 'consecutive_low_mood',
    observation: `The last ${run} morning check-ins all logged 'down' mood. Worth a look.`,
    details: { window_days: windowDays, run_length: run },
  };
}

// ----- helpers -----

interface SkipRow {
  date: string;
  slot_key: string;
}

/** Workouts with status='skipped' in the local-time window, newest-first. */
async function skippedWorkouts(windowDays: number): Promise<SkipRow[]> {
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - (windowDays - 1));
  const cutoffKey = ymd(cutoff);
  const docs = await WorkoutLog.find({
    status: 'skipped',
    date: { $gte: cutoffKey },
  })
    .sort({ date: -1 })
    .lean();
  return docs.map((d) => ({
    date: d.date,
    slot_key: d.slot_key as string,
  }));
}

interface CheckinRow {
  date: string;
  mood: MoodLevel;
  energy: string;
  awakeness: string;
}

/** Morning check-ins in the window, newest-first. */
async function recentCheckinsByDate(windowDays: number): Promise<CheckinRow[]> {
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - (windowDays - 1));
  const cutoffKey = ymd(cutoff);
  const docs = await MorningCheckin.find({ date: { $gte: cutoffKey } })
    .sort({ date: -1 })
    .lean();
  return docs.map((d) => ({
    date: d.date,
    mood: d.mood as MoodLevel,
    energy: d.energy as string,
    awakeness: d.awakeness as string,
  }));
}
