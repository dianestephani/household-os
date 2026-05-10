import { FinancialProfile } from '../db/models/FinancialProfile.js';
import { Routine } from '../db/models/Routine.js';
import { logActivity } from './activity.js';
import type {
  FinancialProfile as FinancialProfileType,
  OutsourceableSummary,
  OutsourceableSummaryItem,
} from '@household-os/shared/types';

const DAYS_PER_MONTH = 30;

/**
 * Singleton getter for the financial profile. Returns a default-shaped profile
 * if nothing has been saved yet (so the dashboard always has something to render).
 */
export async function getFinancialProfile(): Promise<FinancialProfileType> {
  const existing = await FinancialProfile.findOne({ key: 'self' }).lean();
  if (existing) return existing as unknown as FinancialProfileType;
  return {
    key: 'self',
    monthly_income: 0,
    monthly_fixed_expenses: 0,
    notes: '',
    updated_at: new Date(),
  };
}

export async function setFinancialProfile(input: {
  monthly_income?: number;
  monthly_fixed_expenses?: number;
  notes?: string;
}): Promise<FinancialProfileType> {
  const update: Record<string, unknown> = { updated_at: new Date() };
  if (typeof input.monthly_income === 'number')
    update.monthly_income = input.monthly_income;
  if (typeof input.monthly_fixed_expenses === 'number')
    update.monthly_fixed_expenses = input.monthly_fixed_expenses;
  if (typeof input.notes === 'string') update.notes = input.notes;

  const updated = await FinancialProfile.findOneAndUpdate(
    { key: 'self' },
    { $set: update, $setOnInsert: { key: 'self' } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();

  await logActivity('routine_edited', 'Updated financial profile', {
    metadata: { fields: Object.keys(update) },
  });

  return updated as unknown as FinancialProfileType;
}

export function discretionary(profile: FinancialProfileType): number {
  return Math.max(
    0,
    (profile.monthly_income ?? 0) - (profile.monthly_fixed_expenses ?? 0),
  );
}

/**
 * Estimate monthly occurrences for a routine based on its scheduling. Used to
 * convert per-occurrence outsourcing cost into a monthly figure.
 */
function monthlyOccurrences(scheduling: {
  type?: string;
  interval_days?: number | null;
  biweekly?: boolean | null;
}): number {
  const t = scheduling?.type;
  if (t === 'rolling') {
    const interval = scheduling.interval_days ?? 1;
    return DAYS_PER_MONTH / Math.max(1, interval);
  }
  if (t === 'fixed') {
    // ~4.3 occurrences/mo for weekly, ~2.15 for biweekly.
    return scheduling.biweekly ? 30 / 14 : 30 / 7;
  }
  // as_needed and event_driven default to "you'd choose monthly cadence";
  // surface 1 occurrence/mo as a planning baseline. User can interpret.
  return 1;
}

export async function listOutsourceable(): Promise<OutsourceableSummary> {
  const routines = await Routine.find({
    outsourceable: true,
    active: true,
  }).lean();

  const items: OutsourceableSummaryItem[] = routines.map((r) => {
    const cost = r.outsource_cost_estimate ?? 0;
    const occurrences = monthlyOccurrences(
      (r.scheduling ?? {}) as {
        type?: string;
        interval_days?: number | null;
        biweekly?: boolean | null;
      },
    );
    return {
      routine_key: r.key,
      routine_name: r.name ?? r.key,
      cost_per_occurrence: cost,
      occurrences_per_month: Math.round(occurrences * 10) / 10,
      monthly_cost: Math.round(cost * occurrences * 100) / 100,
    };
  });

  const total_monthly_cost = items.reduce((acc, i) => acc + i.monthly_cost, 0);
  return {
    total_monthly_cost: Math.round(total_monthly_cost * 100) / 100,
    items: items.sort((a, b) => b.monthly_cost - a.monthly_cost),
  };
}

export interface AffordabilityReport {
  profile: FinancialProfileType;
  discretionary_monthly: number;
  outsourceable: OutsourceableSummary;
  fits_within_discretionary: OutsourceableSummaryItem[];
  exceeds_discretionary: OutsourceableSummaryItem[];
  rationale: string;
}

/**
 * Quick affordability snapshot — what could she outsource within her current
 * discretionary monthly amount, prioritized by highest-cost-first?
 */
export async function affordabilityReport(): Promise<AffordabilityReport> {
  const profile = await getFinancialProfile();
  const dispMonthly = discretionary(profile);
  const summary = await listOutsourceable();

  const fits: OutsourceableSummaryItem[] = [];
  const exceeds: OutsourceableSummaryItem[] = [];
  // Greedy fill by largest monthly cost first — matches "what should I
  // prioritize outsourcing if I had to pick?" intuition.
  let used = 0;
  for (const item of summary.items) {
    if (used + item.monthly_cost <= dispMonthly) {
      fits.push(item);
      used += item.monthly_cost;
    } else {
      exceeds.push(item);
    }
  }

  const rationale =
    dispMonthly === 0
      ? "No discretionary set yet. Update the financial profile so I can run real numbers."
      : fits.length === 0
        ? `$${dispMonthly}/mo discretionary doesn't cover any single outsourceable item.`
        : `At $${dispMonthly}/mo discretionary, you could cover ${fits.length} item${fits.length === 1 ? '' : 's'} (~$${used.toFixed(2)}/mo).`;

  return {
    profile,
    discretionary_monthly: dispMonthly,
    outsourceable: summary,
    fits_within_discretionary: fits,
    exceeds_discretionary: exceeds,
    rationale,
  };
}
