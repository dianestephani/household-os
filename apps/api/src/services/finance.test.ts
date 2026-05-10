import { describe, it, expect } from 'vitest';
import { FinancialProfile } from '../db/models/FinancialProfile.js';
import { Routine } from '../db/models/Routine.js';
import {
  affordabilityReport,
  discretionary,
  getFinancialProfile,
  listOutsourceable,
  setFinancialProfile,
} from './finance.js';

async function seedRoutines(): Promise<void> {
  await Routine.create({
    key: 'yard',
    name: 'Yard pickup',
    category: 'pet',
    zone: 'yard',
    scheduling: { type: 'rolling', interval_days: 7, flex_days: 0 },
    estimate_minutes: 25,
    energy: 'medium',
    active: true,
    outsourceable: true,
    outsource_cost_estimate: 30,
  });
  await Routine.create({
    key: 'airbnb_pre',
    name: 'Airbnb pre-clean',
    category: 'airbnb',
    zone: 'whole-house',
    scheduling: { type: 'event_driven', trigger: 'airbnb_checkin_minus_1d' },
    estimate_minutes: 60,
    energy: 'high',
    active: true,
    outsourceable: true,
    outsource_cost_estimate: 120,
  });
  await Routine.create({
    key: 'litter_scoop',
    name: 'Scoop litter',
    category: 'pet',
    zone: 'bathrooms',
    scheduling: { type: 'rolling', interval_days: 1, flex_days: 0 },
    estimate_minutes: 8,
    energy: 'low',
    active: true,
    outsourceable: false,
    outsource_cost_estimate: 0,
  });
}

describe('financial profile', () => {
  it('returns a default-shaped profile when nothing saved', async () => {
    const p = await getFinancialProfile();
    expect(p.monthly_income).toBe(0);
    expect(p.monthly_fixed_expenses).toBe(0);
  });

  it('upserts and reads back', async () => {
    await setFinancialProfile({
      monthly_income: 5000,
      monthly_fixed_expenses: 3500,
      notes: 'baseline',
    });
    const p = await getFinancialProfile();
    expect(p.monthly_income).toBe(5000);
    expect(p.monthly_fixed_expenses).toBe(3500);
    expect(p.notes).toBe('baseline');
  });

  it('partial updates leave other fields intact', async () => {
    await setFinancialProfile({ monthly_income: 5000, monthly_fixed_expenses: 3500 });
    await setFinancialProfile({ notes: 'updated' });
    const p = await getFinancialProfile();
    expect(p.monthly_income).toBe(5000);
    expect(p.monthly_fixed_expenses).toBe(3500);
    expect(p.notes).toBe('updated');
  });

  it('only one profile exists (singleton on key=self)', async () => {
    await setFinancialProfile({ monthly_income: 1000 });
    await setFinancialProfile({ monthly_income: 2000 });
    const all = await FinancialProfile.find({}).lean();
    expect(all.length).toBe(1);
    expect(all[0]?.monthly_income).toBe(2000);
  });
});

describe('discretionary', () => {
  it('returns income minus fixed', () => {
    expect(
      discretionary({
        key: 'self',
        monthly_income: 5000,
        monthly_fixed_expenses: 3500,
        updated_at: new Date(),
      }),
    ).toBe(1500);
  });

  it('clamps negative to zero', () => {
    expect(
      discretionary({
        key: 'self',
        monthly_income: 1000,
        monthly_fixed_expenses: 3500,
        updated_at: new Date(),
      }),
    ).toBe(0);
  });
});

describe('listOutsourceable', () => {
  it('returns only outsourceable=true active routines', async () => {
    await seedRoutines();
    const summary = await listOutsourceable();
    const keys = summary.items.map((i) => i.routine_key);
    expect(keys).toContain('yard');
    expect(keys).toContain('airbnb_pre');
    expect(keys).not.toContain('litter_scoop');
  });

  it('computes monthly_cost from cadence', async () => {
    await seedRoutines();
    const summary = await listOutsourceable();
    const yard = summary.items.find((i) => i.routine_key === 'yard');
    // 7-day interval → 30/7 ≈ 4.29 occurrences/mo. $30 × 4.29 ≈ $128.57.
    expect(yard?.occurrences_per_month).toBeCloseTo(4.3, 1);
    expect(yard?.monthly_cost).toBeCloseTo(128.57, 1);
  });

  it('sorts by monthly_cost desc', async () => {
    await seedRoutines();
    const summary = await listOutsourceable();
    const costs = summary.items.map((i) => i.monthly_cost);
    for (let i = 1; i < costs.length; i++) {
      expect(costs[i - 1]).toBeGreaterThanOrEqual(costs[i]!);
    }
  });

  it('total_monthly_cost is the sum of items', async () => {
    await seedRoutines();
    const summary = await listOutsourceable();
    const sum = summary.items.reduce((acc, i) => acc + i.monthly_cost, 0);
    expect(summary.total_monthly_cost).toBeCloseTo(sum, 2);
  });
});

describe('affordabilityReport', () => {
  it('greedy splits items into fits / exceeds based on discretionary', async () => {
    await seedRoutines();
    await setFinancialProfile({
      monthly_income: 5000,
      monthly_fixed_expenses: 4870,
    });
    // discretionary = $130, yard ≈ $128.57/mo fits, airbnb_pre $120/mo doesn't fit on top.
    const report = await affordabilityReport();
    expect(report.discretionary_monthly).toBe(130);
    const fitsKeys = report.fits_within_discretionary.map((i) => i.routine_key);
    const exceedsKeys = report.exceeds_discretionary.map((i) => i.routine_key);
    expect(fitsKeys).toContain('yard');
    expect(exceedsKeys).toContain('airbnb_pre');
  });

  it('rationale flags zero discretionary', async () => {
    await seedRoutines();
    const report = await affordabilityReport();
    expect(report.rationale).toMatch(/no discretionary set/i);
  });
});
