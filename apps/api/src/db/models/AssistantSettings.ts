import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

/**
 * Versioned system prompt for the unified assistant. Singleton keyed
 * 'current'. Every PATCH appends to `versions` so Diane can roll back from
 * the Stuff/Assistant Settings panel. See HANDOFF §50 Phase A.
 */
const AssistantSettingsSchema = new Schema(
  {
    key: { type: String, unique: true, required: true, default: 'current' },
    system_prompt: { type: String, required: true },
    model: { type: String, default: 'claude-sonnet-4-6' },
    versions: {
      type: [
        new Schema(
          {
            ts: { type: Date, default: () => new Date() },
            system_prompt: { type: String, required: true },
            edited_by: { type: String, enum: ['user', 'seed'], default: 'user' },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    updated_at: { type: Date, default: () => new Date() },
  },
  { timestamps: false },
);

export type AssistantSettingsDoc = InferSchemaType<typeof AssistantSettingsSchema>;
type AssistantSettingsModel = Model<AssistantSettingsDoc>;
export const AssistantSettings: AssistantSettingsModel =
  (mongoose.models.AssistantSettings as AssistantSettingsModel | undefined) ??
  mongoose.model<AssistantSettingsDoc>(
    'AssistantSettings',
    AssistantSettingsSchema,
  );
