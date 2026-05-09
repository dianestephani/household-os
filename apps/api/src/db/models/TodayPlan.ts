import { Schema, model, type InferSchemaType } from 'mongoose';

const PlanItemSchema = new Schema(
  {
    routine_key: { type: String, required: true },
    name: { type: String, required: true },
    estimate_minutes: { type: Number, default: 0 },
    energy: { type: String, default: 'low' },
    status: { type: String, default: 'pending' }, // pending|in_progress|done|deferred
    order: { type: Number, default: 0 },
    completed_at: Date,
  },
  { _id: false },
);

const SwapPoolItemSchema = new Schema(
  {
    routine_key: { type: String, required: true },
    name: { type: String, required: true },
    estimate_minutes: { type: Number, default: 0 },
    energy: { type: String, default: 'low' },
    deferred_at: { type: Date, default: () => new Date() },
    reason: { type: String, default: 'manual_swap' },
  },
  { _id: false },
);

const PublisherSchema = new Schema(
  {
    calendar_event_id: String,
    alexa_notif_id: String,
    last_synced_at: Date,
  },
  { _id: false },
);

const TodayPlanSchema = new Schema(
  {
    date: { type: String, unique: true, required: true, index: true }, // YYYY-MM-DD
    day_type: { type: String, default: 'weekday_default' },
    budget_minutes: { type: Number, default: 45 },
    current_energy: { type: String, default: 'medium' },
    items: { type: [PlanItemSchema], default: [] },
    swap_pool: { type: [SwapPoolItemSchema], default: [] },
    publisher: { type: PublisherSchema, default: () => ({}) },
  },
  { timestamps: true },
);

export type TodayPlanDoc = InferSchemaType<typeof TodayPlanSchema>;
export const TodayPlan = model('TodayPlan', TodayPlanSchema);
