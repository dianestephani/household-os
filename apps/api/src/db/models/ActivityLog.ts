import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

const ActivityLogSchema = new Schema(
  {
    ts: { type: Date, default: () => new Date(), index: true },
    kind: { type: String, required: true, index: true },
    summary: { type: String, required: true },
    actor: { type: String, default: 'user' }, // user|system|cron
    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: false },
);

export type ActivityLogDoc = InferSchemaType<typeof ActivityLogSchema>;
type ActivityLogModel = Model<ActivityLogDoc>;
export const ActivityLog: ActivityLogModel =
  (mongoose.models.ActivityLog as ActivityLogModel | undefined) ??
  mongoose.model<ActivityLogDoc>('ActivityLog', ActivityLogSchema);
