import { Routine } from '../db/models/Routine.js';
import { logActivity } from './activity.js';
import type { CadenceShiftStrategy } from '@household-os/shared/types';

/**
 * §50 Phase E — Routine CRUD service. `patchRoutine` allow-list trimmed to
 * the surviving fields (`name`, `category`, `zone`, `scheduling`,
 * `estimate_minutes`, `last_done`, `active`, `outsourceable`,
 * `outsource_cost_estimate`, `monthly_occurrences_override`). Dropped:
 * `energy`, `skip_if`, `also_triggers`, `budget_gated`, `cost_estimate`.
 *
 * The `cadence_shift_strategy` parameter is metadata about HOW to interpret
 * a cadence-affecting patch on an appointment-enabled routine:
 *
 *   - 'shift_all'  → default. Patch applies forward as usual.
 *   - 'skip_one'   → also clear the upcoming linked Calendar event. The
 *                    routine's `interval_days` is left unchanged (typical
 *                    use: "skip the next haircut, but my cadence is fine").
 *   - 'one_off'    → no side effects beyond the patch itself. The caller is
 *                    saying "this is a one-time tweak" — the activity log
 *                    captures the intent so future analytics can distinguish
 *                    "cadence drift" from "schedule rearrangement."
 *
 * The strategy is recorded in the `routine_edited` activity entry's metadata
 * regardless of which branch fires; downstream consumers can correlate.
 */

const ALLOWED_FIELDS = [
  'name',
  'category',
  'zone',
  'scheduling',
  'estimate_minutes',
  'last_done',
  'active',
  'outsourceable',
  'outsource_cost_estimate',
  'monthly_occurrences_override',
] as const;

export async function listRoutines(filter: { category?: string; zone?: string } = {}) {
  const q: Record<string, unknown> = { active: true };
  if (filter.category) q.category = filter.category;
  if (filter.zone) q.zone = filter.zone;
  return Routine.find(q).lean();
}

export async function getRoutine(key: string) {
  return Routine.findOne({ key }).lean();
}

export async function patchRoutine(
  key: string,
  patch: Record<string, unknown>,
  options: { cadence_shift_strategy?: CadenceShiftStrategy } = {},
) {
  const safe: Record<string, unknown> = {};
  for (const k of ALLOWED_FIELDS) {
    if (k in patch) safe[k] = patch[k];
  }
  await Routine.updateOne({ key }, { $set: safe });

  // skip_one: clear the linked Calendar event so the next reconcile pass
  // doesn't fight us. We don't touch the Google Calendar side — Diane
  // deletes the event there herself (or leaves it; the orphan is tagged
  // with the routine name and harmless).
  if (options.cadence_shift_strategy === 'skip_one') {
    await Routine.updateOne(
      { key },
      {
        $set: {
          'appointment.calendar_event_id': null,
          'appointment.last_event_start': null,
        },
      },
    );
  }

  await logActivity('routine_edited', `Edited routine: ${key}`, {
    metadata: {
      key,
      fields: Object.keys(safe),
      cadence_shift_strategy: options.cadence_shift_strategy ?? null,
    },
  });
  return Routine.findOne({ key }).lean();
}

export async function createRoutine(doc: Record<string, unknown>) {
  return Routine.create(doc);
}

export async function softDeleteRoutine(key: string) {
  await Routine.updateOne({ key }, { $set: { active: false } });
  return { key, active: false };
}
