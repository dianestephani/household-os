import { describe, it, expect } from 'vitest';
import { MorningCheckin } from '../db/models/MorningCheckin.js';
import { WorkoutLog } from '../db/models/WorkoutLog.js';
import {
  consecutiveLowMood,
  detectPatterns,
  skippedWorkoutsByAwakeness,
} from './patterns-simple.js';
import { ymd } from '../utils/dates.js';

function daysAgo(n: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return ymd(d);
}

async function seedCheckin(
  date: string,
  mood: 'good' | 'neutral' | 'down',
  energy: 'low' | 'medium' | 'high',
  awakeness: 'groggy' | 'meh' | 'alert',
): Promise<void> {
  await MorningCheckin.create({
    date,
    mood,
    energy,
    awakeness,
    note: '',
  });
}

async function seedWorkout(
  date: string,
  status: 'done' | 'skipped' | 'partial',
): Promise<void> {
  await WorkoutLog.create({
    ts: new Date(),
    date,
    slot_key: 'lift_flex',
    status,
  });
}

describe('patterns-simple (§50 Phase D)', () => {
  describe('skippedWorkoutsByAwakeness', () => {
    it('returns null below 2 skips', async () => {
      await seedWorkout(daysAgo(2), 'skipped');
      await seedCheckin(daysAgo(2), 'down', 'low', 'groggy');
      expect(await skippedWorkoutsByAwakeness(30)).toBeNull();
    });

    it('surfaces when all skips share the same awakeness (all-on phrasing)', async () => {
      await seedWorkout(daysAgo(2), 'skipped');
      await seedWorkout(daysAgo(5), 'skipped');
      await seedWorkout(daysAgo(10), 'skipped');
      await seedCheckin(daysAgo(2), 'down', 'low', 'groggy');
      await seedCheckin(daysAgo(5), 'down', 'low', 'groggy');
      await seedCheckin(daysAgo(10), 'down', 'low', 'groggy');

      const result = await skippedWorkoutsByAwakeness(30);
      expect(result).not.toBeNull();
      expect(result?.kind).toBe('workout_skip_by_awakeness');
      expect(result?.observation).toContain('all on groggy mornings');
      expect(result?.details.matching_skips).toBe(3);
      expect(result?.details.awakeness).toBe('groggy');
      expect(result?.details.ratio).toBe(1);
    });

    it('surfaces with majority phrasing when ≥75% match the dominant awakeness', async () => {
      // 4 skips: 3 groggy, 1 alert → 75% match
      await seedWorkout(daysAgo(2), 'skipped');
      await seedWorkout(daysAgo(5), 'skipped');
      await seedWorkout(daysAgo(10), 'skipped');
      await seedWorkout(daysAgo(15), 'skipped');
      await seedCheckin(daysAgo(2), 'neutral', 'medium', 'groggy');
      await seedCheckin(daysAgo(5), 'neutral', 'medium', 'groggy');
      await seedCheckin(daysAgo(10), 'neutral', 'medium', 'groggy');
      await seedCheckin(daysAgo(15), 'good', 'high', 'alert');

      const result = await skippedWorkoutsByAwakeness(30);
      expect(result).not.toBeNull();
      expect(result?.observation).toContain('3 of 4 skipped');
      expect(result?.observation).toContain('groggy');
      expect(result?.details.matching_skips).toBe(3);
      expect(result?.details.ratio).toBe(0.75);
    });

    it('returns null when no awakeness dominates ≥75%', async () => {
      // 4 skips: 2 groggy, 2 alert → 50% each
      await seedWorkout(daysAgo(2), 'skipped');
      await seedWorkout(daysAgo(5), 'skipped');
      await seedWorkout(daysAgo(10), 'skipped');
      await seedWorkout(daysAgo(15), 'skipped');
      await seedCheckin(daysAgo(2), 'neutral', 'medium', 'groggy');
      await seedCheckin(daysAgo(5), 'neutral', 'medium', 'groggy');
      await seedCheckin(daysAgo(10), 'good', 'high', 'alert');
      await seedCheckin(daysAgo(15), 'good', 'high', 'alert');

      expect(await skippedWorkoutsByAwakeness(30)).toBeNull();
    });

    it('drops skips that have no same-day check-in (insufficient signal)', async () => {
      // 3 skips: 1 with check-in, 2 without — observed=1, below threshold
      await seedWorkout(daysAgo(2), 'skipped');
      await seedWorkout(daysAgo(5), 'skipped');
      await seedWorkout(daysAgo(10), 'skipped');
      await seedCheckin(daysAgo(2), 'down', 'low', 'groggy');
      // intentionally skip seedCheckin for days 5 + 10

      expect(await skippedWorkoutsByAwakeness(30)).toBeNull();
    });

    it('ignores done + partial workouts (only skips count)', async () => {
      await seedWorkout(daysAgo(2), 'done');
      await seedWorkout(daysAgo(5), 'partial');
      await seedCheckin(daysAgo(2), 'good', 'high', 'alert');
      await seedCheckin(daysAgo(5), 'good', 'high', 'alert');

      expect(await skippedWorkoutsByAwakeness(30)).toBeNull();
    });

    it('respects the window (skips outside the window do not count)', async () => {
      await seedWorkout(daysAgo(2), 'skipped');
      await seedWorkout(daysAgo(60), 'skipped'); // outside 30-day window
      await seedCheckin(daysAgo(2), 'down', 'low', 'groggy');
      await seedCheckin(daysAgo(60), 'down', 'low', 'groggy');

      expect(await skippedWorkoutsByAwakeness(30)).toBeNull();
    });
  });

  describe('consecutiveLowMood', () => {
    it('returns null with fewer than 3 consecutive down days', async () => {
      await seedCheckin(daysAgo(0), 'down', 'low', 'meh');
      await seedCheckin(daysAgo(1), 'down', 'low', 'meh');
      await seedCheckin(daysAgo(2), 'neutral', 'medium', 'meh');

      expect(await consecutiveLowMood(14)).toBeNull();
    });

    it('surfaces a 3-day low-mood run from today backwards', async () => {
      await seedCheckin(daysAgo(0), 'down', 'low', 'meh');
      await seedCheckin(daysAgo(1), 'down', 'low', 'meh');
      await seedCheckin(daysAgo(2), 'down', 'low', 'meh');
      await seedCheckin(daysAgo(3), 'neutral', 'medium', 'meh');

      const result = await consecutiveLowMood(14);
      expect(result).not.toBeNull();
      expect(result?.kind).toBe('consecutive_low_mood');
      expect(result?.observation).toContain('last 3 morning check-ins');
      expect(result?.details.run_length).toBe(3);
    });

    it("breaks the run on the first non-'down' day", async () => {
      // Most-recent is neutral → run is 0
      await seedCheckin(daysAgo(0), 'neutral', 'medium', 'meh');
      await seedCheckin(daysAgo(1), 'down', 'low', 'meh');
      await seedCheckin(daysAgo(2), 'down', 'low', 'meh');
      await seedCheckin(daysAgo(3), 'down', 'low', 'meh');

      expect(await consecutiveLowMood(14)).toBeNull();
    });

    it('returns null when there are no check-ins at all', async () => {
      expect(await consecutiveLowMood(14)).toBeNull();
    });
  });

  describe('detectPatterns orchestrator', () => {
    it('returns [] when no detector fires', async () => {
      expect(await detectPatterns(30)).toEqual([]);
    });

    it('returns multiple patterns when several detectors fire', async () => {
      // Skip pattern: 2 skips, both groggy
      await seedWorkout(daysAgo(2), 'skipped');
      await seedWorkout(daysAgo(5), 'skipped');
      await seedCheckin(daysAgo(2), 'down', 'low', 'groggy');
      await seedCheckin(daysAgo(5), 'down', 'low', 'groggy');
      // Add a 3rd 'down' day so the low-mood pattern fires.
      await seedCheckin(daysAgo(0), 'down', 'low', 'groggy');
      await seedCheckin(daysAgo(1), 'down', 'low', 'groggy');

      const patterns = await detectPatterns(30);
      const kinds = patterns.map((p) => p.kind).sort();
      expect(kinds).toContain('workout_skip_by_awakeness');
      expect(kinds).toContain('consecutive_low_mood');
    });

    it('clamps windowDays into [1, 90]', async () => {
      // Out-of-range windows shouldn't crash.
      expect(Array.isArray(await detectPatterns(0))).toBe(true);
      expect(Array.isArray(await detectPatterns(500))).toBe(true);
      expect(Array.isArray(await detectPatterns(-10))).toBe(true);
    });
  });
});
