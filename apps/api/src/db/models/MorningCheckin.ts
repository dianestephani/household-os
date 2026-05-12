import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

/**
 * One document per local date (`date: YYYY-MM-DD`, unique). Replaces the old
 * `MoodLog` + `EnergyLog` + `CheckIn` split per §50 — Diane logs all three
 * pulses in one go in the morning and they're stored together. Optional note
 * captures the qualitative context (formerly the `ContextEntry` use case).
 *
 * The shape mirrors the spec block in §50 verbatim. `note` capped at 500
 * chars at the schema level; the service layer trims first so we never store
 * leading/trailing whitespace.
 */
const MorningCheckinSchema = new Schema(
  {
    date: { type: String, required: true, unique: true, index: true },
    mood: {
      type: String,
      enum: ['good', 'neutral', 'down'],
      required: true,
    },
    energy: {
      type: String,
      enum: ['low', 'medium', 'high'],
      required: true,
    },
    awakeness: {
      type: String,
      enum: ['groggy', 'meh', 'alert'],
      required: true,
    },
    note: { type: String, default: '', maxlength: 500 },
    created_at: { type: Date, default: () => new Date() },
    updated_at: { type: Date, default: () => new Date() },
  },
  { timestamps: false },
);

export type MorningCheckinDoc = InferSchemaType<typeof MorningCheckinSchema>;
type MorningCheckinModel = Model<MorningCheckinDoc>;
export const MorningCheckin: MorningCheckinModel =
  (mongoose.models.MorningCheckin as MorningCheckinModel | undefined) ??
  mongoose.model<MorningCheckinDoc>('MorningCheckin', MorningCheckinSchema);
