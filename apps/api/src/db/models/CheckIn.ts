import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

const QuestionSchema = new Schema(
  {
    id: { type: String, required: true },
    text: { type: String, required: true },
    type: { type: String, required: true }, // text|choice|mood|energy
    choices: [{ value: String, label: String }],
    answer: String,
    side_effect: String,
  },
  { _id: false },
);

const CheckInSchema = new Schema(
  {
    type: { type: String, required: true, index: true },
    scheduled_for: { type: Date, required: true, index: true },
    status: { type: String, default: 'pending', index: true },
    questions: { type: [QuestionSchema], default: [] },
    context: {
      kind: String,
      routine_key: String,
      routine_name: String,
      count: Number,
      window_days: Number,
    },
    answered_at: Date,
    created_at: { type: Date, default: () => new Date() },
  },
  { timestamps: false },
);

export type CheckInDoc = InferSchemaType<typeof CheckInSchema>;
type CheckInModel = Model<CheckInDoc>;
export const CheckIn: CheckInModel =
  (mongoose.models.CheckIn as CheckInModel | undefined) ??
  mongoose.model<CheckInDoc>('CheckIn', CheckInSchema);
