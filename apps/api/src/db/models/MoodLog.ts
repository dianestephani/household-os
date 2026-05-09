import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

const MoodLogSchema = new Schema(
  {
    ts: { type: Date, default: () => new Date(), index: true },
    level: { type: String, required: true }, // good|neutral|down
    source: { type: String, required: true },
  },
  { timestamps: false },
);

export type MoodLogDoc = InferSchemaType<typeof MoodLogSchema>;
type MoodLogModel = Model<MoodLogDoc>;
export const MoodLog: MoodLogModel =
  (mongoose.models.MoodLog as MoodLogModel | undefined) ??
  mongoose.model<MoodLogDoc>('MoodLog', MoodLogSchema);
