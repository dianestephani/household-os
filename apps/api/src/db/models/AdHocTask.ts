import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

const AdHocTaskSchema = new Schema(
  {
    ts: { type: Date, default: () => new Date(), index: true },
    zone: { type: String, required: true },
    name: { type: String, required: true },
    source: { type: String, required: true }, // 'zone_assessment'|'voice'|'mcp'|'persona'|'manual'
    source_assessment_id: String,
    severity: { type: String, default: 'meh' }, // fine|meh|rough
    estimate_minutes: { type: Number, default: 15 },
    energy: { type: String, default: 'medium' },
    status: { type: String, default: 'open', index: true }, // open|done|cancelled
    done_at: Date,
  },
  { timestamps: false },
);

export type AdHocTaskDoc = InferSchemaType<typeof AdHocTaskSchema>;
type AdHocTaskModel = Model<AdHocTaskDoc>;
export const AdHocTask: AdHocTaskModel =
  (mongoose.models.AdHocTask as AdHocTaskModel | undefined) ??
  mongoose.model<AdHocTaskDoc>('AdHocTask', AdHocTaskSchema);
