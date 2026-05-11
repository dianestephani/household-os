import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

const MealDaySchema = new Schema(
  {
    day: { type: String, required: true },
    title: { type: String, required: true },
    effort: { type: String, required: true }, // 'cook' | 'easy' | 'grab'
    effort_label: { type: String, required: true },
    time: { type: String, required: true },
    protein: { type: String, required: true },
    servings: { type: String, required: true },
    note: String,
    ingredients: { type: [String], default: [] },
    steps: { type: [String], default: [] },
  },
  { _id: false },
);

/**
 * A meal plan for one ISO-style week (Monday start). The `start_date` field
 * is unique so Diane can re-paste a week from Grocery Manager and overwrite
 * the previous version cleanly. Lives outside the Routine system because
 * meals aren't cadences — they're a weekly creative artifact.
 */
const MealWeekSchema = new Schema(
  {
    start_date: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    title: String,
    meals: { type: [MealDaySchema], default: [] },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } },
);

export type MealWeekDoc = InferSchemaType<typeof MealWeekSchema>;
type MealWeekModel = Model<MealWeekDoc>;
export const MealWeek: MealWeekModel =
  (mongoose.models.MealWeek as MealWeekModel | undefined) ??
  mongoose.model<MealWeekDoc>('MealWeek', MealWeekSchema);
