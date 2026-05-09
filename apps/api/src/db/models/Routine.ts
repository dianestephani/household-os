import { Schema, model, type InferSchemaType } from 'mongoose';

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
  },
  { timestamps: true },
);

export type RoutineDoc = InferSchemaType<typeof RoutineSchema>;
export const Routine = model('Routine', RoutineSchema);
