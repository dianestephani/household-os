import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

/**
 * One Alexa Reminder per Google Calendar appointment we've notified for.
 * Used by the appointment-reconcile cron to avoid creating duplicate
 * reminders when re-running within the 24-hour window. See §47 Phase 6a.
 */
const AlexaReminderSchema = new Schema(
  {
    calendar_event_id: { type: String, required: true, index: true },
    alexa_reminder_id: { type: String, required: true },
    /** When the reminder is scheduled to fire (mirrors the appointment start). */
    scheduled_at: { type: Date, required: true },
    routine_key: String,
    /** When Amazon will expire the reminder. */
    expires_at: Date,
    created_at: { type: Date, default: () => new Date() },
  },
  { timestamps: false },
);

export type AlexaReminderDoc = InferSchemaType<typeof AlexaReminderSchema>;
type AlexaReminderModel = Model<AlexaReminderDoc>;
export const AlexaReminder: AlexaReminderModel =
  (mongoose.models.AlexaReminder as AlexaReminderModel | undefined) ??
  mongoose.model<AlexaReminderDoc>('AlexaReminder', AlexaReminderSchema);
