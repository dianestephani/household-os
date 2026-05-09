import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

const EnergyLogSchema = new Schema(
  {
    ts: { type: Date, default: () => new Date(), index: true },
    level: { type: String, required: true }, // low|medium|high
    source: { type: String, required: true }, // voice|dashboard|shortcut|cron-default
  },
  { timestamps: false },
);

export type EnergyLogDoc = InferSchemaType<typeof EnergyLogSchema>;
type EnergyLogModel = Model<EnergyLogDoc>;
export const EnergyLog: EnergyLogModel =
  (mongoose.models.EnergyLog as EnergyLogModel | undefined) ??
  mongoose.model<EnergyLogDoc>('EnergyLog', EnergyLogSchema);
