import { reconcileAllAppointments } from '../services/appointments.js';

/**
 * Hourly reconcile job — pulls each linked routine's calendar event from
 * Google and applies the diff (§47 Phase 4). Logs `appointment_rescheduled`
 * / `appointment_deleted_externally` / `task_done` (past_completed) via the
 * service. Skipped automatically when no Calendar client is configured or
 * NODE_ENV=test (the I/O wrappers no-op).
 *
 * §50 Phase C: the second pass that scheduled Alexa Reminders has been
 * removed — §50 explicitly defers the Reminders integration indefinitely.
 * The morning push + WhatsLeftIntent are enough; LWA stays only for the
 * shopping-list integration (also kept per §50).
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
  } catch (err) {
    console.error('[cron] appointment reconcile failed', err);
  }
}
