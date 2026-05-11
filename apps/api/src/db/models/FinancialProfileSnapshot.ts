import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

/**
 * Append-only history of FinancialProfile saves. Written by
 * `finance-history.saveSnapshot()` on every PATCH to the singleton profile,
 * on CSV apply-to-profile (Phase 5), and when restoring a prior snapshot.
 * Never updated in place — restoration writes a new snapshot pointing at
 * the source via `parent_snapshot_id`.
 */
const FinancialProfileSnapshotSchema = new Schema(
  {
    ts: { type: Date, default: () => new Date(), index: true },
    source: { type: String, required: true }, // 'dashboard_edit' | 'csv_import' | 'restore'
    profile: { type: Schema.Types.Mixed, required: true },
    parent_snapshot_id: { type: Schema.Types.ObjectId, default: null },
  },
  { timestamps: false },
);

export type FinancialProfileSnapshotDoc = InferSchemaType<
  typeof FinancialProfileSnapshotSchema
>;
type FinancialProfileSnapshotModel = Model<FinancialProfileSnapshotDoc>;
export const FinancialProfileSnapshot: FinancialProfileSnapshotModel =
  (mongoose.models.FinancialProfileSnapshot as
    | FinancialProfileSnapshotModel
    | undefined) ??
  mongoose.model<FinancialProfileSnapshotDoc>(
    'FinancialProfileSnapshot',
    FinancialProfileSnapshotSchema,
  );
