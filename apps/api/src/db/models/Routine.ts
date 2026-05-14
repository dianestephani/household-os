import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

/**
 * §50 Phase E — Routine schema simplification. Dropped fields: `energy`,
 * `scheduling.flex_days`, `scheduling.week_in_cycle`, `skip_if`,
 * `also_triggers`, `budget_gated`, `cost_estimate`. The `zone_rotation`
 * scheduling type also retired (now only `rolling | fixed | as_needed |
 * event_driven`). Added: `monthly_occurrences_override` for `listOutsourceable`'s
 * cost math when the interval-based default is wrong.
 *
 * Mongoose strips unknown fields silently on insert/update with the default
 * `strict: true`, so existing Atlas docs with dropped fields keep working —
 * the dropped fields just become invisible to the runtime.
 */
const SchedulingSchema = new Schema(
  {
    type: { type: String, required: true },
    interval_days: Number,
    day_of_week: String,
    biweekly: Boolean,
    trigger: String,
  },
  { _id: false },
);

const AppointmentSchema = new Schema(
  {
    enabled: { type: Boolean, default: false },
    calendar_event_id: String,
    default_duration_minutes: Number,
    last_synced_at: Date,
    last_event_start: Date,
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
    last_done: Date,
    active: { type: Boolean, default: true },
    outsourceable: { type: Boolean, default: false },
    outsource_cost_estimate: { type: Number, default: 0 },
    monthly_occurrences_override: { type: Number },
    appointment: { type: AppointmentSchema, default: undefined },
  },
  { timestamps: true },
);

export type RoutineDoc = InferSchemaType<typeof RoutineSchema>;
type RoutineModel = Model<RoutineDoc>;
export const Routine: RoutineModel =
  (mongoose.models.Routine as RoutineModel | undefined) ??
  mongoose.model<RoutineDoc>('Routine', RoutineSchema);
