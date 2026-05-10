import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

const FinancialProfileSchema = new Schema(
  {
    /** Singleton: there's only one profile, keyed 'self'. */
    key: { type: String, unique: true, required: true, default: 'self' },
    monthly_gross_income: { type: Number, default: 0 },
    monthly_tax_estimate: { type: Number, default: 0 },
    monthly_fixed_expenses: { type: Number, default: 0 },
    state: { type: String, default: '' },
    filing_status: { type: String, default: 'single' },
    monthly_extra_withholding: { type: Number, default: 0 },
    notes: String,
    expense_breakdown: String,
    updated_at: { type: Date, default: () => new Date() },
  },
  { timestamps: false },
);

export type FinancialProfileDoc = InferSchemaType<typeof FinancialProfileSchema>;
type FinancialProfileModel = Model<FinancialProfileDoc>;
export const FinancialProfile: FinancialProfileModel =
  (mongoose.models.FinancialProfile as FinancialProfileModel | undefined) ??
  mongoose.model<FinancialProfileDoc>(
    'FinancialProfile',
    FinancialProfileSchema,
  );
