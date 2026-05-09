import { Schema, model, type InferSchemaType } from 'mongoose';

const EnergyLogSchema = new Schema(
  {
    ts: { type: Date, default: () => new Date(), index: true },
    level: { type: String, required: true }, // low|medium|high
    source: { type: String, required: true }, // voice|dashboard|shortcut|cron-default
  },
  { timestamps: false },
);

export type EnergyLogDoc = InferSchemaType<typeof EnergyLogSchema>;
export const EnergyLog = model('EnergyLog', EnergyLogSchema);
