import { describe, it, expect } from 'vitest';
import { FinancialProfile } from '../db/models/FinancialProfile.js';
import { ActivityLog } from '../db/models/ActivityLog.js';
import {
  getFinancialProfile,
  getProjectedIncomeForMonth,
  setFinancialProfile,
  setProjectedIncomeForMonth,
} from './finance.js';

/**
 * §50 Phase E — per-month projected income override.
 *
 *   monthly_projected_income_overrides: Map<YYYY-MM, dollars>
 *
 * `getProjectedIncomeForMonth` returns the override if set, else falls back
 * to `monthly_gross_income`, else null. `setProjectedIncomeForMonth({month,
 * amount})` writes a single key; `amount: null` clears it.
 */

describe('projected income overrides (§50 Phase E)', () => {
  describe('getProjectedIncomeForMonth', () => {
    it('returns null when no profile exists and no override is set', async () => {
      const result = await getProjectedIncomeForMonth('2026-05');
      expect(result).toBeNull();
    });

    it('falls back to monthly_gross_income when no override is set', async () => {
      await setFinancialProfile({ monthly_gross_income: 5800 });
      const result = await getProjectedIncomeForMonth('2026-05');
      expect(result).toEqual({ amount: 5800, source: 'gross_fallback' });
    });

    it('uses the override when set for the requested month', async () => {
      await setFinancialProfile({ monthly_gross_income: 5800 });
      await setProjectedIncomeForMonth({ month: '2026-05', amount: 6200 });
      const result = await getProjectedIncomeForMonth('2026-05');
      expect(result).toEqual({ amount: 6200, source: 'override' });
    });

    it('falls back to gross for months without an override even when other months DO have one', async () => {
      await setFinancialProfile({ monthly_gross_income: 5800 });
      await setProjectedIncomeForMonth({ month: '2026-05', amount: 6200 });
      const result = await getProjectedIncomeForMonth('2026-06');
      expect(result).toEqual({ amount: 5800, source: 'gross_fallback' });
    });

    it('rejects malformed month strings', async () => {
      await expect(getProjectedIncomeForMonth('2026/05')).rejects.toThrow(
        /YYYY-MM/,
      );
      await expect(getProjectedIncomeForMonth('not-a-month')).rejects.toThrow(
        /YYYY-MM/,
      );
    });
  });

  describe('setProjectedIncomeForMonth', () => {
    it('persists a new override and lets you read it back via the profile', async () => {
      await setProjectedIncomeForMonth({ month: '2026-05', amount: 6200 });
      const profile = await getFinancialProfile();
      expect(
        profile.monthly_projected_income_overrides?.['2026-05'],
      ).toBe(6200);
    });

    it('keys multiple overrides independently', async () => {
      await setProjectedIncomeForMonth({ month: '2026-05', amount: 5800 });
      await setProjectedIncomeForMonth({ month: '2026-06', amount: 7100 });
      const profile = await getFinancialProfile();
      expect(
        profile.monthly_projected_income_overrides?.['2026-05'],
      ).toBe(5800);
      expect(
        profile.monthly_projected_income_overrides?.['2026-06'],
      ).toBe(7100);
    });

    it('updates an existing override in place (single doc)', async () => {
      await setProjectedIncomeForMonth({ month: '2026-05', amount: 5800 });
      await setProjectedIncomeForMonth({ month: '2026-05', amount: 6400 });
      const count = await FinancialProfile.countDocuments({ key: 'self' });
      expect(count).toBe(1);
      const result = await getProjectedIncomeForMonth('2026-05');
      expect(result?.amount).toBe(6400);
    });

    it('clearing with amount=null removes that month and falls back to gross', async () => {
      await setFinancialProfile({ monthly_gross_income: 5800 });
      await setProjectedIncomeForMonth({ month: '2026-05', amount: 6200 });
      await setProjectedIncomeForMonth({ month: '2026-05', amount: null });
      const result = await getProjectedIncomeForMonth('2026-05');
      expect(result).toEqual({ amount: 5800, source: 'gross_fallback' });
    });

    it('rejects negative amounts', async () => {
      await expect(
        setProjectedIncomeForMonth({ month: '2026-05', amount: -100 }),
      ).rejects.toThrow(/≥ 0/);
    });

    it('rejects malformed month strings', async () => {
      await expect(
        setProjectedIncomeForMonth({
          month: 'bad-month',
          amount: 100,
        }),
      ).rejects.toThrow(/YYYY-MM/);
    });

    it('logs a routine_edited activity entry with the month + amount', async () => {
      await setProjectedIncomeForMonth({ month: '2026-05', amount: 6200 });
      const entries = await ActivityLog.find({
        kind: 'routine_edited',
        summary: /Set projected income/,
      });
      expect(entries.length).toBe(1);
      const meta = entries[0]?.metadata as {
        month?: string;
        amount?: number;
        fields?: string[];
      };
      expect(meta.month).toBe('2026-05');
      expect(meta.amount).toBe(6200);
      expect(meta.fields).toContain('monthly_projected_income_overrides');
    });
  });
});
