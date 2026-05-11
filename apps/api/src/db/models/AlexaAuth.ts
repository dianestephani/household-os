import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

/**
 * Stores the Amazon LWA (Login with Amazon) access token + refresh token
 * for the skill's permission-granting flow. Singleton keyed `'self'` — same
 * single-user pattern as `FinancialProfile`. Populated either by:
 *   1. Skill events (Amazon pushes us a fresh accessToken after the user
 *      grants reminders/lists permission in the Alexa app), OR
 *   2. A manual OAuth callback during initial account-linking.
 *
 * Token validity windows vary by scope; we re-fetch when within 5 minutes
 * of expiry. See §47 Phase 6 in HANDOFF.
 */
const AlexaAuthSchema = new Schema(
  {
    key: { type: String, unique: true, required: true, default: 'self' },
    access_token: String,
    refresh_token: String,
    /** ISO timestamp when access_token expires. */
    expires_at: Date,
    /** Space-separated list of granted scopes (e.g. `alexa::household:lists:write alexa::devices:all:reminders:write`). */
    scopes: String,
    updated_at: { type: Date, default: () => new Date() },
  },
  { timestamps: false },
);

export type AlexaAuthDoc = InferSchemaType<typeof AlexaAuthSchema>;
type AlexaAuthModel = Model<AlexaAuthDoc>;
export const AlexaAuth: AlexaAuthModel =
  (mongoose.models.AlexaAuth as AlexaAuthModel | undefined) ??
  mongoose.model<AlexaAuthDoc>('AlexaAuth', AlexaAuthSchema);
