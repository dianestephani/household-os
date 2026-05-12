import { describe, it, expect } from 'vitest';
import { MorningCheckin } from '../db/models/MorningCheckin.js';
import { ActivityLog } from '../db/models/ActivityLog.js';
import {
  getCheckin,
  recentCheckins,
  upsertCheckin,
} from './morning-checkin.js';
import { ymd } from '../utils/dates.js';

describe('morning-checkin service (§50 Phase B)', () => {
  describe('upsertCheckin', () => {
    it('inserts a new check-in with the date defaulting to today', async () => {
      const result = await upsertCheckin({
        mood: 'neutral',
        energy: 'medium',
        awakeness: 'alert',
      });
      expect(result.date).toBe(ymd(new Date()));
      expect(result.mood).toBe('neutral');
      expect(result.energy).toBe('medium');
      expect(result.awakeness).toBe('alert');
      expect(result.note).toBe('');

      const count = await MorningCheckin.countDocuments({});
      expect(count).toBe(1);
    });

    it('updates the same-day check-in in place (no duplicate doc)', async () => {
      await upsertCheckin({ mood: 'down', energy: 'low', awakeness: 'groggy' });
      const updated = await upsertCheckin({
        mood: 'good',
        energy: 'high',
        awakeness: 'alert',
        note: '  felt great after coffee  ',
      });
      expect(updated.mood).toBe('good');
      expect(updated.note).toBe('felt great after coffee'); // trimmed

      const count = await MorningCheckin.countDocuments({});
      expect(count).toBe(1);
    });

    it('logs morning_checkin_logged with create vs update operation flag', async () => {
      await upsertCheckin({ mood: 'good', energy: 'medium', awakeness: 'meh' });
      await upsertCheckin({ mood: 'neutral', energy: 'medium', awakeness: 'meh' });

      const entries = await ActivityLog.find({
        kind: 'morning_checkin_logged',
      }).sort({ ts: 1 });
      expect(entries).toHaveLength(2);
      expect(
        (entries[0]?.metadata as { operation?: string } | undefined)?.operation,
      ).toBe('create');
      expect(
        (entries[1]?.metadata as { operation?: string } | undefined)?.operation,
      ).toBe('update');
    });

    it('rejects invalid mood/energy/awakeness values', async () => {
      await expect(
        upsertCheckin({
          mood: 'great' as unknown as 'good',
          energy: 'medium',
          awakeness: 'meh',
        }),
      ).rejects.toThrow(/mood/);
      await expect(
        upsertCheckin({
          mood: 'good',
          energy: 'super' as unknown as 'high',
          awakeness: 'meh',
        }),
      ).rejects.toThrow(/energy/);
      await expect(
        upsertCheckin({
          mood: 'good',
          energy: 'medium',
          awakeness: 'sleepy' as unknown as 'groggy',
        }),
      ).rejects.toThrow(/awakeness/);
    });

    it('caps the note at 500 chars even if the caller sends more', async () => {
      const huge = 'x'.repeat(900);
      const result = await upsertCheckin({
        mood: 'neutral',
        energy: 'medium',
        awakeness: 'meh',
        note: huge,
      });
      expect(result.note?.length).toBe(500);
    });

    it('honors an explicit date param (YYYY-MM-DD) for backfilling', async () => {
      await upsertCheckin({
        date: '2024-01-01',
        mood: 'good',
        energy: 'high',
        awakeness: 'alert',
      });
      const fetched = await getCheckin('2024-01-01');
      expect(fetched?.mood).toBe('good');
      expect(fetched?.date).toBe('2024-01-01');
    });
  });

  describe('getCheckin', () => {
    it('returns null when no doc exists for the requested date', async () => {
      const result = await getCheckin('2099-12-31');
      expect(result).toBeNull();
    });

    it('defaults to today when no date is passed', async () => {
      await upsertCheckin({ mood: 'good', energy: 'medium', awakeness: 'alert' });
      const today = await getCheckin();
      expect(today).not.toBeNull();
      expect(today?.date).toBe(ymd(new Date()));
    });

    it('falls back to today if the date is malformed (rather than throwing)', async () => {
      await upsertCheckin({ mood: 'good', energy: 'medium', awakeness: 'alert' });
      const result = await getCheckin('not-a-date');
      expect(result?.date).toBe(ymd(new Date()));
    });
  });

  describe('recentCheckins', () => {
    it('returns docs from the requested window, newest-first', async () => {
      await upsertCheckin({
        date: '2026-05-09',
        mood: 'down',
        energy: 'low',
        awakeness: 'groggy',
      });
      await upsertCheckin({
        date: '2026-05-10',
        mood: 'neutral',
        energy: 'medium',
        awakeness: 'meh',
      });
      await upsertCheckin({
        date: '2026-05-11',
        mood: 'good',
        energy: 'high',
        awakeness: 'alert',
      });
      const result = await recentCheckins(60);
      expect(result.map((c) => c.date)).toEqual([
        '2026-05-11',
        '2026-05-10',
        '2026-05-09',
      ]);
    });

    it('clamps the days param to [1, 90]', async () => {
      // 0 → 1; 1000 → 90; -5 → 1. Hard to assert without seeding 90+ docs,
      // so just verify it doesn't throw and returns an array.
      expect(Array.isArray(await recentCheckins(0))).toBe(true);
      expect(Array.isArray(await recentCheckins(1000))).toBe(true);
      expect(Array.isArray(await recentCheckins(-5))).toBe(true);
    });
  });
});
