import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

const DeferralEventSchema = new Schema(
  {
    ts: { type: Date, default: () => new Date(), index: true },
    date: { type: String, required: true, index: true }, // YYYY-MM-DD
    routine_key: { type: String, required: true, index: true },
    routine_name: { type: String, required: true },
    reason: { type: String, required: true },
    notes: String,
    source: { type: String, default: 'user' }, // 'auto' | 'user'
  },
  { timestamps: false },
);

export type DeferralEventDoc = InferSchemaType<typeof DeferralEventSchema>;
type DeferralEventModel = Model<DeferralEventDoc>;
export const DeferralEvent: DeferralEventModel =
  (mongoose.models.DeferralEvent as DeferralEventModel | undefined) ??
  mongoose.model<DeferralEventDoc>('DeferralEvent', DeferralEventSchema);
