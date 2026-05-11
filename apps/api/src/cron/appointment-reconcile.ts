import { reconcileAllAppointments } from '../services/appointments.js';

/**
 * Hourly reconcile job — pulls each linked routine's calendar event from
 * Google and applies the diff. Logs `appointment_rescheduled` /
 * `appointment_deleted_externally` / `task_done` (past-completed branch) via
 * the service. Skipped automatically when no Calendar client is configured
 * or NODE_ENV=test (the I/O wrappers no-op).
 *
 * Push notifications (`events.watch`) would eliminate the polling delay, but
 * are deliberately deferred — §47 Phase 4 explicitly says "Skip this for v1
 * of the refactor — hourly polling is fine."
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
