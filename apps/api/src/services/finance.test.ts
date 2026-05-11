import { describe, it, expect } from 'vitest';
import { ActivityLog } from '../db/models/ActivityLog.js';
import { FinancialProfile } from '../db/models/FinancialProfile.js';
import { FinancialProfileSnapshot } from '../db/models/FinancialProfileSnapshot.js';
import { Routine } from '../db/models/Routine.js';
import {
  affordabilityReport,
  discretionary,
  estimateMonthlyTax,
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
    expect(p.monthly_gross_income).toBe(0);
    expect(p.monthly_tax_estimate).toBe(0);
    expect(p.monthly_fixed_expenses).toBe(0);
    expect(p.filing_status).toBe('single');
  });

  it('upserts and reads back', async () => {
    await setFinancialProfile({
      monthly_gross_income: 6000,
      monthly_tax_estimate: 1200,
      monthly_fixed_expenses: 3500,
      state: 'wa',
      filing_status: 'single',
      monthly_extra_withholding: 100,
      notes: 'baseline',
    });
    const p = await getFinancialProfile();
    expect(p.monthly_gross_income).toBe(6000);
    expect(p.monthly_tax_estimate).toBe(1200);
    expect(p.monthly_fixed_expenses).toBe(3500);
    expect(p.state).toBe('WA');
    expect(p.monthly_extra_withholding).toBe(100);
    expect(p.notes).toBe('baseline');
  });

  it('partial updates leave other fields intact', async () => {
    await setFinancialProfile({
      monthly_gross_income: 5000,
      monthly_tax_estimate: 900,
      monthly_fixed_expenses: 3500,
    });
    await setFinancialProfile({ notes: 'updated' });
    const p = await getFinancialProfile();
    expect(p.monthly_gross_income).toBe(5000);
    expect(p.monthly_tax_estimate).toBe(900);
    expect(p.monthly_fixed_expenses).toBe(3500);
    expect(p.notes).toBe('updated');
  });

  it('only one profile exists (singleton on key=self)', async () => {
    await setFinancialProfile({ monthly_gross_income: 1000 });
    await setFinancialProfile({ monthly_gross_income: 2000 });
    const all = await FinancialProfile.find({}).lean();
    expect(all.length).toBe(1);
    expect(all[0]?.monthly_gross_income).toBe(2000);
  });

  it('writes a snapshot on every PATCH and links it on the activity entry', async () => {
    await setFinancialProfile({ monthly_gross_income: 4000, state: 'WA' });
    await setFinancialProfile({ monthly_gross_income: 5500 });

    const snaps = await FinancialProfileSnapshot.find({}).sort({ ts: 1 }).lean();
    expect(snaps.length).toBe(2);
    expect(snaps[0]?.source).toBe('dashboard_edit');
    const firstProfile = snaps[0]?.profile as { monthly_gross_income?: number };
    const secondProfile = snaps[1]?.profile as { monthly_gross_income?: number };
    expect(firstProfile.monthly_gross_income).toBe(4000);
    expect(secondProfile.monthly_gross_income).toBe(5500);

    // Both PATCHes wrote a routine_edited entry; the most recent should
    // reference the second snapshot.
    const entries = await ActivityLog.find({ kind: 'routine_edited' })
      .sort({ ts: -1 })
      .lean();
    expect(entries.length).toBe(2);
    const meta = entries[0]?.metadata as { snapshot_id?: string };
    expect(meta?.snapshot_id).toBe(String(snaps[1]?._id));
  });

  it('activity log records per-field diff on PATCH', async () => {
    await setFinancialProfile({ monthly_gross_income: 4000, state: 'WA' });
    await setFinancialProfile({
      monthly_gross_income: 5500,
      state: 'CA',
      notes: 'started new gig',
    });

    const latest = await ActivityLog.findOne({ kind: 'routine_edited' })
      .sort({ ts: -1 })
      .lean();
    const meta = latest?.metadata as {
      diff?: Record<string, { before: unknown; after: unknown }>;
      fields?: string[];
    };
    expect(meta?.fields).toEqual(
      expect.arrayContaining(['monthly_gross_income', 'state', 'notes']),
    );
    expect(meta?.diff?.monthly_gross_income).toEqual({
      before: 4000,
      after: 5500,
    });
    expect(meta?.diff?.state).toEqual({ before: 'WA', after: 'CA' });
    // notes was previously unset → before should be null
    expect(meta?.diff?.notes?.before).toBeFalsy();
    expect(meta?.diff?.notes?.after).toBe('started new gig');
  });

  it('first-ever save (no prior profile) records before=null in diff', async () => {
    await setFinancialProfile({ monthly_gross_income: 3000 });
    const entry = await ActivityLog.findOne({ kind: 'routine_edited' }).lean();
    const meta = entry?.metadata as {
      diff?: Record<string, { before: unknown; after: unknown }>;
    };
    expect(meta?.diff?.monthly_gross_income?.before).toBeNull();
    expect(meta?.diff?.monthly_gross_income?.after).toBe(3000);
  });
});

describe('discretionary', () => {
  it('returns gross minus tax minus fixed', () => {
    expect(
      discretionary({
        key: 'self',
        monthly_gross_income: 6000,
        monthly_tax_estimate: 1000,
        monthly_fixed_expenses: 3500,
        updated_at: new Date(),
      }),
    ).toBe(1500);
  });

  it('clamps negative to zero', () => {
    expect(
      discretionary({
        key: 'self',
        monthly_gross_income: 1000,
        monthly_tax_estimate: 200,
        monthly_fixed_expenses: 3500,
        updated_at: new Date(),
      }),
    ).toBe(0);
  });
});

describe('estimateMonthlyTax', () => {
  it('returns zero on zero income', () => {
    const e = estimateMonthlyTax({ monthly_gross_income: 0 });
    expect(e.total).toBe(0);
    expect(e.effective_rate).toBe(0);
  });

  it('WA single — no state tax, federal + FICA only', () => {
    const e = estimateMonthlyTax({
      monthly_gross_income: 5000,
      state: 'WA',
      filing_status: 'single',
      monthly_extra_withholding: 0,
    });
    expect(e.state_tax).toBe(0);
    expect(e.federal).toBeGreaterThan(0);
    expect(e.fica).toBeGreaterThan(0);
    expect(e.total).toBeCloseTo(e.federal + e.fica + e.state_tax + e.extra, 1);
    // 7.65% FICA on $5k = $382.50/mo
    expect(e.fica).toBeCloseTo(382.5, 1);
  });

  it('adds extra withholding to total', () => {
    const a = estimateMonthlyTax({
      monthly_gross_income: 5000,
      state: 'WA',
      monthly_extra_withholding: 0,
    });
    const b = estimateMonthlyTax({
      monthly_gross_income: 5000,
      state: 'WA',
      monthly_extra_withholding: 200,
    });
    expect(b.total - a.total).toBeCloseTo(200, 1);
    expect(b.extra).toBe(200);
  });

  it('uses higher effective rate for known state vs no state', () => {
    const wa = estimateMonthlyTax({
      monthly_gross_income: 8000,
      state: 'WA',
      filing_status: 'single',
    });
    const ca = estimateMonthlyTax({
      monthly_gross_income: 8000,
      state: 'CA',
      filing_status: 'single',
    });
    expect(ca.state_tax).toBeGreaterThan(wa.state_tax);
    expect(ca.total).toBeGreaterThan(wa.total);
  });

  it('flags unknown state in notes', () => {
    const e = estimateMonthlyTax({
      monthly_gross_income: 5000,
      state: 'ZZ',
    });
    expect(e.notes).toMatch(/not in lookup/i);
    expect(e.state_tax).toBe(0);
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
      monthly_gross_income: 6000,
      monthly_tax_estimate: 1000,
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
