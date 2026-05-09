import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

const ZoneAssessmentSchema = new Schema(
  {
    ts: { type: Date, default: () => new Date(), index: true },
    zone: { type: String, required: true, index: true },
    level: { type: String, required: true }, // fine|meh|rough
    notes: String,
    source_checkin_id: String,
  },
  { timestamps: false },
);

export type ZoneAssessmentDoc = InferSchemaType<typeof ZoneAssessmentSchema>;
type ZoneAssessmentModel = Model<ZoneAssessmentDoc>;
export const ZoneAssessment: ZoneAssessmentModel =
  (mongoose.models.ZoneAssessment as ZoneAssessmentModel | undefined) ??
  mongoose.model<ZoneAssessmentDoc>('ZoneAssessment', ZoneAssessmentSchema);
