import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

const SchedulingSchema = new Schema(
  {
    type: { type: String, required: true },
    interval_days: Number,
    flex_days: Number,
    day_of_week: String,
    biweekly: Boolean,
    trigger: String,
    week_in_cycle: Number,
  },
  { _id: false },
);

const RoutineSchema = new Schema(
  {
    key: { type: String, unique: true, required: true, index: true },
    name: { type: String, required: true },
    category: String,
    zone: String,
    scheduling: { type: SchedulingSchema, required: true },
    estimate_minutes: { type: Number, default: 0 },
    energy: { type: String, default: 'low' },
    skip_if: String,
    also_triggers: [String],
    last_done: Date,
    active: { type: Boolean, default: true },
    outsourceable: { type: Boolean, default: false },
    outsource_cost_estimate: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export type RoutineDoc = InferSchemaType<typeof RoutineSchema>;
type RoutineModel = Model<RoutineDoc>;
export const Routine: RoutineModel =
  (mongoose.models.Routine as RoutineModel | undefined) ??
  mongoose.model<RoutineDoc>('Routine', RoutineSchema);
