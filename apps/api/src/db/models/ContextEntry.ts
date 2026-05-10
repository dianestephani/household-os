import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

const ContextEntrySchema = new Schema(
  {
    ts: { type: Date, default: () => new Date(), index: true },
    text: { type: String, required: true },
    tags: { type: [String], default: undefined },
    energy: String, // low|medium|high
    mood: String, // good|neutral|down
    dogsit_count: Number,
    blocked_activities: { type: [String], default: undefined },
    related_persona: { type: String, default: 'both', index: true }, // household|finance|both
    source: { type: String, required: true }, // voice|dashboard|persona|api
  },
  { timestamps: false },
);

export type ContextEntryDoc = InferSchemaType<typeof ContextEntrySchema>;
type ContextEntryModel = Model<ContextEntryDoc>;
export const ContextEntry: ContextEntryModel =
  (mongoose.models.ContextEntry as ContextEntryModel | undefined) ??
  mongoose.model<ContextEntryDoc>('ContextEntry', ContextEntrySchema);
