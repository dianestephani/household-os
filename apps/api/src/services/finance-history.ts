import { Types } from 'mongoose';
import { FinancialProfile } from '../db/models/FinancialProfile.js';
import { FinancialProfileSnapshot } from '../db/models/FinancialProfileSnapshot.js';
import { RocketMoneyImport } from '../db/models/RocketMoneyImport.js';
import { logActivity } from './activity.js';
import { formatParsedAsBreakdown } from './csv-parser.js';
import type {
  FinancialProfile as FinancialProfileType,
  ImportKind,
  ParsedImport,
  RocketMoneyImport as RocketMoneyImportType,
  SnapshotSource,
} from '@household-os/shared/types';

/**
 * Phase 2 of §47 refactor — append-only history of the FinancialProfile
 * singleton plus a record of every RocketMoney paste/CSV import. Pure
 * persistence + activity logging; the UI (Phase 5) and the apply-to-profile
 * flow build on top of this.
 *
 * Deliberately reads the FinancialProfile model directly (rather than
 * importing from finance.ts) to avoid a circular dependency — finance.ts
 * needs to call `saveSnapshot()` from inside `setFinancialProfile`.
 */

export interface SnapshotInput {
  source: SnapshotSource;
  parent_snapshot_id?: string | null;
}

/**
 * Reads the current FinancialProfile singleton and writes a snapshot of it.
 * Returns the inserted snapshot doc (lean) so callers can chain
 * `applied_to_snapshot_id` references onto a RocketMoneyImport.
 */
export async function saveSnapshot(input: SnapshotInput): Promise<{
  _id: string;
  ts: Date;
  source: SnapshotSource;
  profile: FinancialProfileType;
  parent_snapshot_id: string | null;
}> {
  const existing = await FinancialProfile.findOne({ key: 'self' }).lean();
  // If nothing has been saved yet, snapshot a default-shaped profile rather
  // than refusing to snapshot — keeps the history honest about "what did the
  // profile look like at this moment."
  const profile = (existing ?? {
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
  }) as unknown as FinancialProfileType;

  const parentId =
    input.parent_snapshot_id && Types.ObjectId.isValid(input.parent_snapshot_id)
      ? new Types.ObjectId(input.parent_snapshot_id)
      : null;

  const doc = await FinancialProfileSnapshot.create({
    ts: new Date(),
    source: input.source,
    profile,
    parent_snapshot_id: parentId,
  });

  return {
    _id: String(doc._id),
    ts: doc.ts as Date,
    source: doc.source as SnapshotSource,
    profile,
    parent_snapshot_id: parentId ? String(parentId) : null,
  };
}

export async function listSnapshots(limit = 50) {
  return FinancialProfileSnapshot.find({})
    .sort({ ts: -1 })
    .limit(Math.max(1, Math.min(limit, 200)))
    .lean();
}

/**
 * Restores a prior snapshot as the current profile. Writes:
 *   1. The singleton profile fields back to the saved values
 *   2. A NEW snapshot tagged source='restore' with parent_snapshot_id
 *      pointing at the snapshot that was restored
 *   3. A `finance_snapshot_restored` activity entry
 *
 * Returns the restored profile. Throws if `snapshotId` doesn't exist.
 */
export async function restoreSnapshot(
  snapshotId: string,
): Promise<FinancialProfileType> {
  if (!Types.ObjectId.isValid(snapshotId)) {
    throw new Error(`invalid snapshot id: ${snapshotId}`);
  }
  const snap = await FinancialProfileSnapshot.findById(snapshotId).lean();
  if (!snap) {
    throw new Error(`snapshot not found: ${snapshotId}`);
  }

  const profile = snap.profile as FinancialProfileType;
  await FinancialProfile.findOneAndUpdate(
    { key: 'self' },
    {
      $set: {
        monthly_gross_income: profile.monthly_gross_income ?? 0,
        monthly_tax_estimate: profile.monthly_tax_estimate ?? 0,
        monthly_fixed_expenses: profile.monthly_fixed_expenses ?? 0,
        state: profile.state ?? '',
        filing_status: profile.filing_status ?? 'single',
        monthly_extra_withholding: profile.monthly_extra_withholding ?? 0,
        notes: profile.notes ?? '',
        expense_breakdown: profile.expense_breakdown ?? '',
        updated_at: new Date(),
      },
      $setOnInsert: { key: 'self' },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();

  // Write the chained snapshot AFTER the profile update so the new snapshot
  // reflects the restored state.
  const chained = await saveSnapshot({
    source: 'restore',
    parent_snapshot_id: String(snap._id),
  });

  await logActivity(
    'finance_snapshot_restored',
    `Restored financial profile snapshot`,
    {
      metadata: {
        restored_from: String(snap._id),
        restored_from_ts: snap.ts,
        new_snapshot_id: chained._id,
      },
    },
  );

  return chained.profile;
}

export interface ImportInput {
  kind: ImportKind;
  raw: string;
  filename?: string;
  parsed?: ParsedImport | null;
}

export async function addImport(input: ImportInput): Promise<{
  _id: string;
  ts: Date;
  kind: ImportKind;
  filename?: string;
  raw: string;
  parsed: ParsedImport | null;
  applied_to_snapshot_id: string | null;
}> {
  const raw = (input.raw ?? '').trim();
  if (!raw) {
    throw new Error('import raw text required');
  }
  if (input.kind !== 'paste' && input.kind !== 'csv') {
    throw new Error(`invalid import kind: ${input.kind}`);
  }

  const doc = await RocketMoneyImport.create({
    ts: new Date(),
    kind: input.kind,
    filename: input.filename,
    raw,
    parsed: input.parsed ?? null,
    applied_to_snapshot_id: null,
  });

  await logActivity(
    'finance_import_added',
    `Added RocketMoney ${input.kind} import${input.filename ? ` (${input.filename})` : ''}`,
    {
      metadata: {
        kind: input.kind,
        filename: input.filename ?? null,
        parsed: input.parsed
          ? {
              total: input.parsed.total,
              category_count: input.parsed.categories.length,
            }
          : null,
        raw_length: raw.length,
      },
    },
  );

  return {
    _id: String(doc._id),
    ts: doc.ts as Date,
    kind: doc.kind as ImportKind,
    filename: doc.filename ?? undefined,
    raw: doc.raw,
    parsed: (doc.parsed ?? null) as ParsedImport | null,
    applied_to_snapshot_id: null,
  };
}

export async function listImports(limit = 50): Promise<RocketMoneyImportType[]> {
  const docs = await RocketMoneyImport.find({})
    .sort({ ts: -1 })
    .limit(Math.max(1, Math.min(limit, 200)))
    .lean();
  return docs as unknown as RocketMoneyImportType[];
}

/**
 * Applies a stored import to the financial profile's `expense_breakdown`
 * field, writes a fresh snapshot tagged with the import's source kind, and
 * links the import doc to that snapshot.
 *
 * Bypasses `setFinancialProfile` deliberately — we want the snapshot's
 * `source` to be `paste_import` / `csv_import`, not `dashboard_edit`, so the
 * history view can distinguish "Diane typed in the profile form" from
 * "Diane applied a RocketMoney import."
 */
export async function applyImportToProfile(
  importId: string,
): Promise<{
  profile: FinancialProfileType;
  snapshot_id: string;
  import_id: string;
}> {
  if (!Types.ObjectId.isValid(importId)) {
    throw new Error(`invalid import id: ${importId}`);
  }
  const imp = await RocketMoneyImport.findById(importId).lean();
  if (!imp) {
    throw new Error(`import not found: ${importId}`);
  }

  const newBreakdown =
    imp.kind === 'csv' && imp.parsed
      ? formatParsedAsBreakdown(imp.parsed as ParsedImport)
      : imp.raw;

  const updated = await FinancialProfile.findOneAndUpdate(
    { key: 'self' },
    {
      $set: { expense_breakdown: newBreakdown, updated_at: new Date() },
      $setOnInsert: { key: 'self' },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();

  const snap = await saveSnapshot({
    source: imp.kind === 'csv' ? 'csv_import' : 'paste_import',
  });

  await RocketMoneyImport.findByIdAndUpdate(importId, {
    $set: { applied_to_snapshot_id: new Types.ObjectId(snap._id) },
  });

  await logActivity(
    'routine_edited',
    `Applied RocketMoney ${imp.kind} import to profile`,
    {
      metadata: {
        fields: ['expense_breakdown'],
        import_id: importId,
        import_kind: imp.kind,
        snapshot_id: snap._id,
        diff: {
          expense_breakdown: {
            before: null,
            after: `${newBreakdown.slice(0, 80)}${newBreakdown.length > 80 ? '…' : ''}`,
          },
        },
      },
    },
  );

  return {
    profile: updated as unknown as FinancialProfileType,
    snapshot_id: snap._id,
    import_id: importId,
  };
}
