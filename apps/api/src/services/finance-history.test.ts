import { describe, it, expect } from 'vitest';
import { ActivityLog } from '../db/models/ActivityLog.js';
import { FinancialProfile } from '../db/models/FinancialProfile.js';
import { FinancialProfileSnapshot } from '../db/models/FinancialProfileSnapshot.js';
import { RocketMoneyImport } from '../db/models/RocketMoneyImport.js';
import {
  addImport,
  applyImportToProfile,
  listImports,
  listSnapshots,
  restoreSnapshot,
  saveSnapshot,
} from './finance-history.js';

async function seedProfile(
  patch: Partial<{
    monthly_gross_income: number;
    monthly_tax_estimate: number;
    monthly_fixed_expenses: number;
    state: string;
    notes: string;
  }>,
): Promise<void> {
  await FinancialProfile.findOneAndUpdate(
    { key: 'self' },
    { $set: { ...patch, updated_at: new Date() }, $setOnInsert: { key: 'self' } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
}

describe('finance-history.saveSnapshot', () => {
  it('snapshots a default-shaped profile when nothing is saved yet', async () => {
    const snap = await saveSnapshot({ source: 'dashboard_edit' });
    expect(snap.source).toBe('dashboard_edit');
    expect(snap.profile.monthly_gross_income).toBe(0);
    expect(snap.profile.filing_status).toBe('single');
    expect(snap.parent_snapshot_id).toBeNull();
    const all = await FinancialProfileSnapshot.find({}).lean();
    expect(all.length).toBe(1);
  });

  it('snapshots the current profile state', async () => {
    await seedProfile({
      monthly_gross_income: 5000,
      state: 'WA',
      notes: 'launch month',
    });
    const snap = await saveSnapshot({ source: 'dashboard_edit' });
    expect(snap.profile.monthly_gross_income).toBe(5000);
    expect(snap.profile.state).toBe('WA');
    expect(snap.profile.notes).toBe('launch month');
  });

  it('stores parent_snapshot_id when chained from a restore', async () => {
    await seedProfile({ monthly_gross_income: 1000 });
    const parent = await saveSnapshot({ source: 'dashboard_edit' });
    const child = await saveSnapshot({
      source: 'restore',
      parent_snapshot_id: parent._id,
    });
    expect(child.parent_snapshot_id).toBe(parent._id);
    expect(child.source).toBe('restore');
  });
});

describe('finance-history.listSnapshots', () => {
  it('returns snapshots newest-first', async () => {
    const first = await saveSnapshot({ source: 'dashboard_edit' });
    // tiny delay to keep timestamps deterministic without sleeping
    await new Promise((r) => setTimeout(r, 5));
    const second = await saveSnapshot({ source: 'dashboard_edit' });
    const list = await listSnapshots();
    expect(list.length).toBe(2);
    expect(String(list[0]?._id)).toBe(second._id);
    expect(String(list[1]?._id)).toBe(first._id);
  });

  it('clamps limit into [1, 200]', async () => {
    for (let i = 0; i < 3; i += 1) {
      await saveSnapshot({ source: 'dashboard_edit' });
    }
    const tinyList = await listSnapshots(0);
    expect(tinyList.length).toBeGreaterThanOrEqual(1);
    const bigList = await listSnapshots(99999);
    expect(bigList.length).toBe(3);
  });
});

describe('finance-history.restoreSnapshot', () => {
  it('writes the snapshot profile back to the singleton and chains a new snapshot', async () => {
    await seedProfile({ monthly_gross_income: 2000, state: 'WA' });
    const original = await saveSnapshot({ source: 'dashboard_edit' });

    // Mutate the live profile away from the snapshotted state.
    await seedProfile({
      monthly_gross_income: 9999,
      state: 'CA',
      notes: 'wrong direction',
    });

    const restored = await restoreSnapshot(original._id);
    expect(restored.monthly_gross_income).toBe(2000);
    expect(restored.state).toBe('WA');

    const live = await FinancialProfile.findOne({ key: 'self' }).lean();
    expect(live?.monthly_gross_income).toBe(2000);
    expect(live?.state).toBe('WA');

    // The restore should have written a NEW snapshot tagged 'restore'.
    const restoreSnaps = await FinancialProfileSnapshot.find({
      source: 'restore',
    }).lean();
    expect(restoreSnaps.length).toBe(1);
    expect(String(restoreSnaps[0]?.parent_snapshot_id)).toBe(original._id);

    // And a finance_snapshot_restored activity entry.
    const entry = await ActivityLog.findOne({
      kind: 'finance_snapshot_restored',
    }).lean();
    expect(entry).toBeTruthy();
    const meta = entry?.metadata as { restored_from?: string } | undefined;
    expect(meta?.restored_from).toBe(original._id);
  });

  it('throws on invalid snapshot id', async () => {
    await expect(restoreSnapshot('not-an-objectid')).rejects.toThrow();
  });

  it('throws when snapshot is not found', async () => {
    // valid ObjectId shape, but nothing in the DB
    await expect(
      restoreSnapshot('507f1f77bcf86cd799439011'),
    ).rejects.toThrow(/not found/);
  });
});

describe('finance-history.addImport', () => {
  it('writes a paste import with no filename and logs finance_import_added', async () => {
    const result = await addImport({
      kind: 'paste',
      raw: 'Groceries $420\nGas $80\n',
    });
    expect(result.kind).toBe('paste');
    expect(result.filename).toBeUndefined();
    expect(result.parsed).toBeNull();
    expect(result.applied_to_snapshot_id).toBeNull();

    const persisted = await RocketMoneyImport.findById(result._id).lean();
    expect(persisted?.kind).toBe('paste');
    expect(persisted?.raw).toBe('Groceries $420\nGas $80');

    const entry = await ActivityLog.findOne({
      kind: 'finance_import_added',
    }).lean();
    expect(entry).toBeTruthy();
    const meta = entry?.metadata as { kind?: string; filename?: string | null };
    expect(meta?.kind).toBe('paste');
    expect(meta?.filename).toBeNull();
  });

  it('writes a csv import with filename and stores parsed shape', async () => {
    const result = await addImport({
      kind: 'csv',
      raw: 'Date,Description,Category,Amount\n2026-05-01,X,Groceries,-100',
      filename: 'april.csv',
      parsed: {
        categories: [{ name: 'Groceries', amount: 100, count: 1 }],
        total: 100,
        period_start: new Date('2026-04-01'),
        period_end: new Date('2026-04-30'),
      },
    });
    expect(result.kind).toBe('csv');
    expect(result.filename).toBe('april.csv');
    expect(result.parsed?.total).toBe(100);
    expect(result.parsed?.categories[0]?.name).toBe('Groceries');

    const entry = await ActivityLog.findOne({
      kind: 'finance_import_added',
    }).lean();
    const meta = entry?.metadata as {
      kind?: string;
      filename?: string | null;
      parsed?: { total?: number; category_count?: number } | null;
    };
    expect(meta?.filename).toBe('april.csv');
    expect(meta?.parsed?.total).toBe(100);
    expect(meta?.parsed?.category_count).toBe(1);
  });

  it('rejects empty raw text', async () => {
    await expect(addImport({ kind: 'paste', raw: '   ' })).rejects.toThrow(
      /raw text required/,
    );
    await expect(addImport({ kind: 'paste', raw: '' })).rejects.toThrow();
  });

  it('rejects invalid kind', async () => {
    await expect(
      // @ts-expect-error — intentional bad input
      addImport({ kind: 'badkind', raw: 'something' }),
    ).rejects.toThrow(/invalid import kind/);
  });
});

describe('finance-history.listImports', () => {
  it('returns imports newest-first', async () => {
    const first = await addImport({ kind: 'paste', raw: 'first' });
    await new Promise((r) => setTimeout(r, 5));
    const second = await addImport({ kind: 'csv', raw: 'second', filename: 'x.csv' });
    const list = await listImports();
    expect(list.length).toBe(2);
    expect(String(list[0]?._id)).toBe(second._id);
    expect(String(list[1]?._id)).toBe(first._id);
  });
});

describe('finance-history.applyImportToProfile', () => {
  it('applies a paste import — copies raw text into expense_breakdown', async () => {
    const imp = await addImport({
      kind: 'paste',
      raw: 'Groceries $420\nGas $80\n',
    });
    const result = await applyImportToProfile(imp._id);
    expect(result.profile.expense_breakdown).toContain('Groceries $420');
    expect(result.snapshot_id).toBeTruthy();
    expect(result.import_id).toBe(imp._id);

    // Snapshot should be tagged 'paste_import'
    const snap = await FinancialProfileSnapshot.findById(
      result.snapshot_id,
    ).lean();
    expect(snap?.source).toBe('paste_import');

    // Import doc should now link to the snapshot
    const persisted = await RocketMoneyImport.findById(imp._id).lean();
    expect(String(persisted?.applied_to_snapshot_id)).toBe(result.snapshot_id);
  });

  it('applies a CSV import — formats parsed categories as expense_breakdown', async () => {
    const imp = await addImport({
      kind: 'csv',
      raw: 'Date,Description,Category,Amount\n2026-05-01,X,Groceries,-100',
      filename: 'april.csv',
      parsed: {
        categories: [
          { name: 'Groceries', amount: 420, count: 12 },
          { name: 'Gas', amount: 80, count: 3 },
        ],
        total: 500,
        period_start: new Date('2026-04-01'),
        period_end: new Date('2026-04-30'),
      },
    });
    const result = await applyImportToProfile(imp._id);
    expect(result.profile.expense_breakdown).toContain('Total: $500.00');
    expect(result.profile.expense_breakdown).toContain('Groceries: $420.00');
    expect(result.profile.expense_breakdown).toContain('Gas: $80.00');

    const snap = await FinancialProfileSnapshot.findById(
      result.snapshot_id,
    ).lean();
    expect(snap?.source).toBe('csv_import');
  });

  it('falls back to raw when CSV import has no parsed payload', async () => {
    const imp = await addImport({
      kind: 'csv',
      raw: 'just some raw text\nanother line',
      // no parsed
    });
    const result = await applyImportToProfile(imp._id);
    expect(result.profile.expense_breakdown).toBe(
      'just some raw text\nanother line',
    );
  });

  it('logs a routine_edited activity entry linked to the import + snapshot', async () => {
    const imp = await addImport({ kind: 'paste', raw: 'sample' });
    const result = await applyImportToProfile(imp._id);

    const entry = await ActivityLog.findOne({
      kind: 'routine_edited',
      'metadata.import_id': imp._id,
    }).lean();
    expect(entry).toBeTruthy();
    const meta = entry?.metadata as {
      import_kind?: string;
      snapshot_id?: string;
      fields?: string[];
    };
    expect(meta?.import_kind).toBe('paste');
    expect(meta?.snapshot_id).toBe(result.snapshot_id);
    expect(meta?.fields).toEqual(['expense_breakdown']);
  });

  it('throws on invalid import id', async () => {
    await expect(applyImportToProfile('not-an-objectid')).rejects.toThrow();
  });

  it('throws when import is not found', async () => {
    await expect(
      applyImportToProfile('507f1f77bcf86cd799439011'),
    ).rejects.toThrow(/not found/);
  });
});
