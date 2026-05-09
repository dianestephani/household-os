import { Schema, model, type InferSchemaType } from 'mongoose';

const TriggerSchema = new Schema(
  {
    type: { type: String, required: true, index: true },
    date: { type: String, required: true, index: true }, // YYYY-MM-DD
    source: { type: String, default: 'manual' },
    source_event_id: String,
    ingested_at: { type: Date, default: () => new Date() },
    notes: String,
  },
  { timestamps: false },
);

TriggerSchema.index(
  { type: 1, date: 1, source_event_id: 1 },
  { unique: true, partialFilterExpression: { source_event_id: { $exists: true } } },
);

export type TriggerDoc = InferSchemaType<typeof TriggerSchema>;
export const Trigger = model('Trigger', TriggerSchema);
