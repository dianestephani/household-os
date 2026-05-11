import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

const ParsedCategorySchema = new Schema(
  {
    name: { type: String, required: true },
    amount: { type: Number, required: true },
    count: Number,
  },
  { _id: false },
);

const ParsedImportSchema = new Schema(
  {
    categories: { type: [ParsedCategorySchema], default: [] },
    total: { type: Number, required: true },
    period_start: Date,
    period_end: Date,
  },
  { _id: false },
);

/**
 * Every RocketMoney paste or CSV upload writes one of these. The raw text is
 * authoritative — `parsed` is best-effort category aggregation that may be
 * null if the input shape didn't match what we expected. The 1MB cap on
 * `raw` is enforced at the route layer (Phase 5).
 */
const RocketMoneyImportSchema = new Schema(
  {
    ts: { type: Date, default: () => new Date(), index: true },
    kind: { type: String, required: true }, // 'paste' | 'csv'
    filename: String,
    raw: { type: String, required: true },
    parsed: { type: ParsedImportSchema, default: null },
    applied_to_snapshot_id: { type: Schema.Types.ObjectId, default: null },
  },
  { timestamps: false },
);

export type RocketMoneyImportDoc = InferSchemaType<
  typeof RocketMoneyImportSchema
>;
type RocketMoneyImportModel = Model<RocketMoneyImportDoc>;
export const RocketMoneyImport: RocketMoneyImportModel =
  (mongoose.models.RocketMoneyImport as RocketMoneyImportModel | undefined) ??
  mongoose.model<RocketMoneyImportDoc>(
    'RocketMoneyImport',
    RocketMoneyImportSchema,
  );
