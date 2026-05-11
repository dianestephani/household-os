import { Routine } from '../db/models/Routine.js';
import { reconcileAllAppointments } from '../services/appointments.js';
import { createReminderForAppointment } from '../services/alexa-reminders.js';

/** Window for "the appointment is coming soon, time to nudge Diane." */
const REMINDER_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Hourly reconcile job — two passes:
 *   1. Pulls each linked routine's calendar event from Google and applies
 *      the diff (Phase 4). Logs `appointment_rescheduled` /
 *      `appointment_deleted_externally` / `task_done` (past_completed) via
 *      the service. Skipped automatically when no Calendar client is
 *      configured or NODE_ENV=test (the I/O wrappers no-op).
 *   2. For every linked routine whose appointment is within the next 24h,
 *      ensure an Alexa Reminder exists (idempotent via the AlexaReminder
 *      collection's `calendar_event_id` key). Skipped when LWA isn't
 *      configured (the service returns null and we move on).
 *
 * Push notifications (`events.watch`) would eliminate the polling delay,
 * but are deliberately deferred — §47 Phase 4 explicitly says "Skip this
 * for v1 of the refactor — hourly polling is fine."
 */
export async function reconcileAppointmentsCron(): Promise<void> {
  try {
    const results = await reconcileAllAppointments();
    const changes = results.filter((r) => r.action !== 'no_change');
    if (changes.length > 0) {
      console.log(
        `[cron] appointment reconcile: ${changes.length} change(s) across ${results.length} routine(s)`,
      );
    }
    await scheduleUpcomingReminders();
  } catch (err) {
    console.error('[cron] appointment reconcile failed', err);
  }
}

async function scheduleUpcomingReminders(): Promise<void> {
  const now = Date.now();
  const horizon = new Date(now + REMINDER_WINDOW_MS);
  const routines = await Routine.find({
    'appointment.enabled': true,
    'appointment.calendar_event_id': { $ne: null },
    'appointment.last_event_start': { $ne: null, $lte: horizon },
  }).lean();

  let created = 0;
  for (const r of routines) {
    const start = r.appointment?.last_event_start;
    const eventId = r.appointment?.calendar_event_id;
    if (!start || !eventId) continue;
    const startDate = new Date(start as unknown as string);
    // Skip if the appointment is already in the past — Phase 4's reconcile
    // already handled completion. Reminders are only for upcoming events.
    if (startDate.getTime() <= now) continue;

    const result = await createReminderForAppointment({
      text: `Heads up — ${r.name} is coming up.`,
      scheduledTime: new Date(startDate.getTime() - 30 * 60 * 1000), // 30 min before
      calendarEventId: eventId,
      routineKey: r.key,
    });
    if (result) created += 1;
  }
  if (created > 0) {
    console.log(`[cron] scheduled ${created} new Alexa reminder(s)`);
  }
}
