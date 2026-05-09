import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

const WorkoutLogSchema = new Schema(
  {
    ts: { type: Date, default: () => new Date(), index: true },
    date: { type: String, required: true, index: true }, // YYYY-MM-DD
    slot_key: { type: String, required: true }, // pt_tue|pt_thu|lift_flex|ad_hoc
    status: { type: String, required: true }, // done|skipped|partial
    mood: String,
    energy: String,
    notes: String,
  },
  { timestamps: false },
);

WorkoutLogSchema.index({ date: 1, slot_key: 1 }, { unique: true });

export type WorkoutLogDoc = InferSchemaType<typeof WorkoutLogSchema>;
type WorkoutLogModel = Model<WorkoutLogDoc>;
export const WorkoutLog: WorkoutLogModel =
  (mongoose.models.WorkoutLog as WorkoutLogModel | undefined) ??
  mongoose.model<WorkoutLogDoc>('WorkoutLog', WorkoutLogSchema);
