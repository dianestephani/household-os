import { FinancialProfile } from '../db/models/FinancialProfile.js';
import { Routine } from '../db/models/Routine.js';
import { logActivity } from './activity.js';
import { saveSnapshot } from './finance-history.js';
import type {
  FilingStatus,
  FinancialProfile as FinancialProfileType,
  OutsourceableSummary,
  OutsourceableSummaryItem,
  TaxEstimate,
} from '@household-os/shared/types';

/** Fields included in the snapshot diff. `key` and `updated_at` are excluded
 *  — `key` never changes and `updated_at` is bumped on every save. */
const DIFFABLE_FIELDS = [
  'monthly_gross_income',
  'monthly_tax_estimate',
  'monthly_fixed_expenses',
  'state',
  'filing_status',
  'monthly_extra_withholding',
  'notes',
  'expense_breakdown',
] as const;

const DAYS_PER_MONTH = 30;

/**
 * Singleton getter for the financial profile. Returns a default-shaped profile
 * if nothing has been saved yet (so the dashboard always has something to render).
 *
 * Mongoose stores `monthly_projected_income_overrides` as a `Map` so object
 * keys round-trip; we flatten it to a plain `Record<string, number>` here so
 * the API response shape stays JSON-friendly.
 */
export async function getFinancialProfile(): Promise<FinancialProfileType> {
  const existing = await FinancialProfile.findOne({ key: 'self' }).lean();
  if (existing) {
    const overridesRaw = (existing as { monthly_projected_income_overrides?: unknown })
      .monthly_projected_income_overrides;
    const overrides = mapToObject(overridesRaw);
    return {
      ...(existing as unknown as FinancialProfileType),
      monthly_projected_income_overrides: overrides,
    };
  }
  return {
    key: 'self',
    monthly_gross_income: 0,
    monthly_tax_estimate: 0,
    monthly_fixed_expenses: 0,
    state: '',
    filing_status: 'single',
    monthly_extra_withholding: 0,
    notes: '',
    expense_breakdown: '',
    updated_at: new Date(),
  };
}

function mapToObject(
  value: unknown,
): Record<string, number> | undefined {
  if (!value) return undefined;
  if (value instanceof Map) {
    return Object.fromEntries(value as Map<string, number>);
  }
  if (typeof value === 'object') {
    return value as Record<string, number>;
  }
  return undefined;
}

/**
 * §50 Phase E — returns the projected income for a given month (YYYY-MM).
 * Falls back to `monthly_gross_income` when the month has no override.
 * Returns `null` only when there's no profile at all + no fallback.
 */
export async function getProjectedIncomeForMonth(
  monthKey: string,
): Promise<{ amount: number; source: 'override' | 'gross_fallback' } | null> {
  if (!/^\d{4}-\d{2}$/.test(monthKey)) {
    throw new Error(`monthKey must be YYYY-MM, got: ${monthKey}`);
  }
  const profile = await getFinancialProfile();
  const overrides = profile.monthly_projected_income_overrides ?? {};
  if (typeof overrides[monthKey] === 'number') {
    return { amount: overrides[monthKey]!, source: 'override' };
  }
  if (profile.monthly_gross_income > 0) {
    return {
      amount: profile.monthly_gross_income,
      source: 'gross_fallback',
    };
  }
  return null;
}

/**
 * §50 Phase E — set the projected income for a specific `YYYY-MM`. Logs to
 * the activity log (kind: routine_edited, metadata.fields includes
 * 'monthly_projected_income_overrides'). Does NOT touch
 * `monthly_gross_income`. Passing `amount = null` clears that month's
 * override (useful for "I typo'd that, reset to gross").
 */
export async function setProjectedIncomeForMonth(input: {
  month: string;
  amount: number | null;
}): Promise<FinancialProfileType> {
  if (!/^\d{4}-\d{2}$/.test(input.month)) {
    throw new Error(`month must be YYYY-MM, got: ${input.month}`);
  }
  const before = await FinancialProfile.findOne({ key: 'self' }).lean();
  const beforeOverrides =
    mapToObject(
      (before as { monthly_projected_income_overrides?: unknown } | null)
        ?.monthly_projected_income_overrides,
    ) ?? {};

  if (input.amount === null) {
    await FinancialProfile.findOneAndUpdate(
      { key: 'self' },
      {
        $unset: { [`monthly_projected_income_overrides.${input.month}`]: '' },
        $set: { updated_at: new Date() },
        $setOnInsert: { key: 'self' },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  } else {
    if (input.amount < 0) {
      throw new Error('amount must be ≥ 0');
    }
    await FinancialProfile.findOneAndUpdate(
      { key: 'self' },
      {
        $set: {
          [`monthly_projected_income_overrides.${input.month}`]: input.amount,
          updated_at: new Date(),
        },
        $setOnInsert: { key: 'self' },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }

  await logActivity(
    'routine_edited',
    `Set projected income for ${input.month}`,
    {
      metadata: {
        fields: ['monthly_projected_income_overrides'],
        month: input.month,
        amount: input.amount,
        before: beforeOverrides[input.month] ?? null,
      },
    },
  );

  return getFinancialProfile();
}

export async function setFinancialProfile(input: {
  monthly_gross_income?: number;
  monthly_tax_estimate?: number;
  monthly_fixed_expenses?: number;
  state?: string;
  filing_status?: FilingStatus;
  monthly_extra_withholding?: number;
  notes?: string;
  expense_breakdown?: string;
}): Promise<FinancialProfileType> {
  const update: Record<string, unknown> = { updated_at: new Date() };
  if (typeof input.monthly_gross_income === 'number')
    update.monthly_gross_income = input.monthly_gross_income;
  if (typeof input.monthly_tax_estimate === 'number')
    update.monthly_tax_estimate = input.monthly_tax_estimate;
  if (typeof input.monthly_fixed_expenses === 'number')
    update.monthly_fixed_expenses = input.monthly_fixed_expenses;
  if (typeof input.state === 'string') update.state = input.state.toUpperCase();
  if (typeof input.filing_status === 'string')
    update.filing_status = input.filing_status;
  if (typeof input.monthly_extra_withholding === 'number')
    update.monthly_extra_withholding = input.monthly_extra_withholding;
  if (typeof input.notes === 'string') update.notes = input.notes;
  if (typeof input.expense_breakdown === 'string')
    update.expense_breakdown = input.expense_breakdown;

  // Capture "before" state so the activity log can record a per-field diff.
  // Falls back to null (= "no prior profile") for the first-ever save.
  const before = await FinancialProfile.findOne({ key: 'self' }).lean();

  const updated = await FinancialProfile.findOneAndUpdate(
    { key: 'self' },
    { $set: update, $setOnInsert: { key: 'self' } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();

  const diff: Record<string, { before: unknown; after: unknown }> = {};
  for (const field of DIFFABLE_FIELDS) {
    if (!(field in update)) continue;
    const b = before ? (before as Record<string, unknown>)[field] : null;
    const a = (update as Record<string, unknown>)[field];
    if (b !== a) diff[field] = { before: b ?? null, after: a ?? null };
  }

  // Snapshot AFTER the write so the recorded state matches the new singleton.
  // Failure here must not break the PATCH — wrap defensively.
  let snapshotId: string | null = null;
  try {
    const snap = await saveSnapshot({ source: 'dashboard_edit' });
    snapshotId = snap._id;
  } catch (err) {
    console.error('[finance] snapshot-on-patch failed', err);
  }

  await logActivity('routine_edited', 'Updated financial profile', {
    metadata: {
      fields: Object.keys(update),
      diff,
      snapshot_id: snapshotId,
    },
  });

  return updated as unknown as FinancialProfileType;
}

/**
 * Discretionary = gross − tax − fixed. Clamped at zero.
 */
export function discretionary(profile: FinancialProfileType): number {
  const gross = profile.monthly_gross_income ?? 0;
  const tax = profile.monthly_tax_estimate ?? 0;
  const fixed = profile.monthly_fixed_expenses ?? 0;
  return Math.max(0, gross - tax - fixed);
}

// ---------- Tax estimator ----------

/**
 * 2025 US federal income tax brackets per filing status.
 * Annual taxable-income breakpoints + marginal rates.
 */
const FEDERAL_BRACKETS: Record<FilingStatus, { upTo: number; rate: number }[]> = {
  single: [
    { upTo: 11_925, rate: 0.10 },
    { upTo: 48_475, rate: 0.12 },
    { upTo: 103_350, rate: 0.22 },
    { upTo: 197_300, rate: 0.24 },
    { upTo: 250_525, rate: 0.32 },
    { upTo: 626_350, rate: 0.35 },
    { upTo: Infinity, rate: 0.37 },
  ],
  married_jointly: [
    { upTo: 23_850, rate: 0.10 },
    { upTo: 96_950, rate: 0.12 },
    { upTo: 206_700, rate: 0.22 },
    { upTo: 394_600, rate: 0.24 },
    { upTo: 501_050, rate: 0.32 },
    { upTo: 751_600, rate: 0.35 },
    { upTo: Infinity, rate: 0.37 },
  ],
  head_of_household: [
    { upTo: 17_000, rate: 0.10 },
    { upTo: 64_850, rate: 0.12 },
    { upTo: 103_350, rate: 0.22 },
    { upTo: 197_300, rate: 0.24 },
    { upTo: 250_500, rate: 0.32 },
    { upTo: 626_350, rate: 0.35 },
    { upTo: Infinity, rate: 0.37 },
  ],
};

const STANDARD_DEDUCTION: Record<FilingStatus, number> = {
  single: 15_000,
  married_jointly: 30_000,
  head_of_household: 22_500,
};

/**
 * Rough effective state-tax rates at moderate single-earner income. Not exact;
 * meant to surface ballpark numbers for affordability decisions, not file
 * returns. Diane can override the estimator output if her real tax differs.
 */
const STATE_EFFECTIVE_RATES: Record<string, number> = {
  AK: 0, FL: 0, NH: 0, NV: 0, SD: 0, TN: 0, TX: 0, WA: 0, WY: 0,
  // Common other states with rough effective rates at $50-100k single:
  CA: 0.05, OR: 0.07, NY: 0.05, MA: 0.05, IL: 0.0495, CO: 0.044,
  GA: 0.04, AZ: 0.025, NC: 0.0425, VA: 0.045, MD: 0.04, NJ: 0.045,
  PA: 0.0307, OH: 0.035, MN: 0.06, MI: 0.0425,
};

function annualFederalTax(annualGross: number, filingStatus: FilingStatus): number {
  const taxable = Math.max(0, annualGross - STANDARD_DEDUCTION[filingStatus]);
  const brackets = FEDERAL_BRACKETS[filingStatus];
  let owed = 0;
  let prevCap = 0;
  for (const b of brackets) {
    if (taxable <= prevCap) break;
    const slice = Math.min(taxable, b.upTo) - prevCap;
    if (slice > 0) owed += slice * b.rate;
    prevCap = b.upTo;
  }
  return owed;
}

/** FICA: Social Security 6.2% (capped at $168,600 wage base for 2025) + Medicare 1.45% */
function annualFicaTax(annualGross: number): number {
  const ssWageBase = 168_600;
  const ss = Math.min(annualGross, ssWageBase) * 0.062;
  const medicare = annualGross * 0.0145;
  return ss + medicare;
}

export function estimateMonthlyTax(input: {
  monthly_gross_income: number;
  state?: string;
  filing_status?: FilingStatus;
  monthly_extra_withholding?: number;
}): TaxEstimate {
  const monthly = input.monthly_gross_income ?? 0;
  const annual = monthly * 12;
  const filing = input.filing_status ?? 'single';
  const stateCode = (input.state ?? '').toUpperCase();
  const extraMonthly = input.monthly_extra_withholding ?? 0;

  const fedAnnual = annualFederalTax(annual, filing);
  const ficaAnnual = annualFicaTax(annual);
  const stateRate = STATE_EFFECTIVE_RATES[stateCode] ?? 0;
  const stateAnnual = annual * stateRate;

  const fedMonthly = fedAnnual / 12;
  const ficaMonthly = ficaAnnual / 12;
  const stateMonthly = stateAnnual / 12;
  const total = fedMonthly + ficaMonthly + stateMonthly + extraMonthly;
  const effective_rate = monthly > 0 ? total / monthly : 0;

  const knownState = stateCode in STATE_EFFECTIVE_RATES;
  const stateNote = stateCode
    ? knownState
      ? `${stateCode} effective rate: ${(stateRate * 100).toFixed(2)}%.`
      : `${stateCode} not in lookup table — state tax assumed 0; adjust manually if needed.`
    : 'No state set — state tax assumed 0.';

  return {
    monthly_gross_income: monthly,
    state: stateCode,
    filing_status: filing,
    monthly_extra_withholding: extraMonthly,
    federal: Math.round(fedMonthly * 100) / 100,
    fica: Math.round(ficaMonthly * 100) / 100,
    state_tax: Math.round(stateMonthly * 100) / 100,
    extra: Math.round(extraMonthly * 100) / 100,
    total: Math.round(total * 100) / 100,
    effective_rate: Math.round(effective_rate * 10000) / 10000,
    notes: `${stateNote} Estimate is rough — uses 2025 federal brackets, standard deduction, and effective state rates. Not a substitute for actual tax software.`,
  };
}

// ---------- Outsourceable + affordability (unchanged math) ----------

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
    return scheduling.biweekly ? 30 / 14 : 30 / 7;
  }
  return 1;
}

export async function listOutsourceable(): Promise<OutsourceableSummary> {
  const routines = await Routine.find({
    outsourceable: true,
    active: true,
  }).lean();

  const items: OutsourceableSummaryItem[] = routines.map((r) => {
    const cost = r.outsource_cost_estimate ?? 0;
    // §50 Phase E — explicit override wins over interval-based math. Use case:
    // a routine with `interval_days = 21` that Diane actually books once a
    // month; the cadence math would say 30/21 ≈ 1.43, but `1` is the truth.
    const override = (r as { monthly_occurrences_override?: number | null })
      .monthly_occurrences_override;
    const occurrences =
      typeof override === 'number' && override > 0
        ? override
        : monthlyOccurrences(
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

export async function affordabilityReport(): Promise<AffordabilityReport> {
  const profile = await getFinancialProfile();
  const dispMonthly = discretionary(profile);
  const summary = await listOutsourceable();

  const fits: OutsourceableSummaryItem[] = [];
  const exceeds: OutsourceableSummaryItem[] = [];
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
