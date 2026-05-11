import { Routine } from '../db/models/Routine.js';
import { logActivity } from './activity.js';
import {
  createEvent as gcalCreate,
  getEvent as gcalGet,
} from '../utils/google-calendar.js';
import type { calendar_v3 } from 'googleapis';
import type {
  Routine as RoutineType,
  RoutineAppointment,
} from '@household-os/shared/types';

/**
 * Phase 4 §47 — per-appointment Google Calendar event lifecycle.
 *
 * Appointment-style routines (head_spa, haircut, oil_change, regular_cleaning, …)
 * get a real Google Calendar event when Diane schedules one. The system links
 * the routine to that event by `calendar_event_id` and trusts Calendar as the
 * source of truth: if she reschedules / cancels in Google Calendar, the cron
 * picks it up hourly and updates the routine.
 *
 * Pure decision function `diffAppointment` is exhaustively tested; the I/O
 * wrappers around it are intentionally thin so they don't need mocking
 * (Google API tests would be more brittle than valuable, same rationale as
 * §40 Google Tasks).
 */

export type DiffAction =
  | 'no_change'
  | 'rescheduled'
  | 'deleted'
  | 'past_completed';

export interface DiffOutcome {
  action: DiffAction;
  /** New `appointment.last_event_start` after applying the diff (undefined = no change to field). */
  new_last_event_start?: Date | null;
  /** New `routine.last_done` after applying the diff (undefined = no change). */
  new_last_done?: Date | null;
  /** New `appointment.calendar_event_id` (undefined = no change). */
  new_calendar_event_id?: string | null;
}

export interface DiffInput {
  /** What we currently know about the appointment from our DB. */
  current: {
    calendar_event_id: string | null;
    last_event_start: Date | null;
    last_done: Date | null;
  };
  /**
   * Google's view of the event.
   *   - parsed `start` Date (or null for all-day or missing)
   *   - `'gone'` if the calendar returned 404/cancelled/410
   *   - `null` if the lookup itself failed transiently (no diff applied)
   */
  event: { start: Date | null } | 'gone' | null;
  /** Clock injection point for tests. Defaults to `new Date()`. */
  now?: Date;
}

/**
 * Pure decision function — given current local state + Google's view, what
 * should we change? Encapsulates the "Calendar wins" rule:
 *   • If event is `'gone'` (404/cancelled), unlink it.
 *   • If event start is in the past and we haven't recorded `last_done` past
 *     that point, set `last_done = event.start`.
 *   • If event start changed (vs. `last_event_start`), record the new value.
 *   • Otherwise no change.
 *
 * Transient lookup failures (event=null) produce no change so we don't
 * blow away state on a network blip.
 */
export function diffAppointment(input: DiffInput): DiffOutcome {
  const { current, event } = input;
  const now = input.now ?? new Date();

  if (event === null) {
    return { action: 'no_change' };
  }

  if (event === 'gone') {
    if (current.calendar_event_id === null) {
      return { action: 'no_change' };
    }
    return {
      action: 'deleted',
      new_calendar_event_id: null,
      new_last_event_start: null,
    };
  }

  const eventStart = event.start;
  const prevStart = current.last_event_start;

  // If the event has a real start time and it's in the past, treat it as
  // completed unless `last_done` is already at-or-after that time.
  const eventInPast =
    eventStart !== null && eventStart.getTime() <= now.getTime();
  const lastDoneCoversIt =
    current.last_done !== null &&
    eventStart !== null &&
    current.last_done.getTime() >= eventStart.getTime();

  if (eventInPast && !lastDoneCoversIt) {
    return {
      action: 'past_completed',
      new_last_done: eventStart,
      new_last_event_start: eventStart,
    };
  }

  // Different start time than we had recorded → user moved the event.
  const startChanged =
    (eventStart?.getTime() ?? null) !== (prevStart?.getTime() ?? null);

  if (startChanged) {
    return {
      action: 'rescheduled',
      new_last_event_start: eventStart,
    };
  }

  return { action: 'no_change' };
}

// ---------- I/O wrappers ----------

function isoOrNull(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

function buildEventBody(
  routine: RoutineType,
  startsAt: Date,
  durationMinutes: number,
): calendar_v3.Schema$Event {
  const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);
  return {
    summary: `📅 ${routine.name}`,
    description: `Household OS appointment for routine "${routine.key}". Edit or move this event in Google Calendar and the system will pick it up within the hour.`,
    start: { dateTime: startsAt.toISOString() },
    end: { dateTime: endsAt.toISOString() },
  };
}

export interface CreateAppointmentInput {
  routine_key: string;
  starts_at: string; // ISO8601
  duration_minutes?: number;
}

export interface CreateAppointmentResult {
  routine: RoutineType;
  calendar_event_id: string | null;
  starts_at: string;
  duration_minutes: number;
  calendar_skipped: boolean;
}

export async function createAppointment(
  input: CreateAppointmentInput,
): Promise<CreateAppointmentResult> {
  const routine = await Routine.findOne({ key: input.routine_key }).lean();
  if (!routine) {
    throw new Error(`routine not found: ${input.routine_key}`);
  }
  const appointment = (routine.appointment ?? null) as RoutineAppointment | null;
  if (!appointment?.enabled) {
    throw new Error(
      `routine "${input.routine_key}" is not appointment-enabled`,
    );
  }

  const startsAt = new Date(input.starts_at);
  if (Number.isNaN(startsAt.getTime())) {
    throw new Error('starts_at must be a valid ISO8601 datetime');
  }
  const durationMinutes =
    input.duration_minutes ?? appointment.default_duration_minutes ?? 60;

  const body = buildEventBody(routine as unknown as RoutineType, startsAt, durationMinutes);
  const event = await gcalCreate(body);
  const calendarEventId = event?.id ?? null;
  const eventStartIso =
    event?.start?.dateTime ??
    event?.start?.date ??
    startsAt.toISOString();
  const eventStart = new Date(eventStartIso);

  const updated = await Routine.findOneAndUpdate(
    { key: input.routine_key },
    {
      $set: {
        'appointment.enabled': true,
        'appointment.calendar_event_id': calendarEventId,
        'appointment.default_duration_minutes':
          appointment.default_duration_minutes ?? durationMinutes,
        'appointment.last_event_start': eventStart,
        'appointment.last_synced_at': new Date(),
      },
    },
    { new: true },
  ).lean();

  await logActivity(
    'appointment_created',
    `Scheduled appointment for "${routine.name}"`,
    {
      metadata: {
        routine_key: input.routine_key,
        starts_at: eventStart.toISOString(),
        duration_minutes: durationMinutes,
        calendar_event_id: calendarEventId,
        calendar_skipped: event === null,
      },
    },
  );

  return {
    routine: updated as unknown as RoutineType,
    calendar_event_id: calendarEventId,
    starts_at: eventStart.toISOString(),
    duration_minutes: durationMinutes,
    calendar_skipped: event === null,
  };
}

export interface ReconcileResult {
  routine_key: string;
  action: DiffAction;
  applied: boolean;
}

export async function reconcileAppointment(
  routineKey: string,
): Promise<ReconcileResult> {
  const routine = await Routine.findOne({ key: routineKey }).lean();
  if (!routine) {
    return { routine_key: routineKey, action: 'no_change', applied: false };
  }
  const appointment = (routine.appointment ?? null) as RoutineAppointment | null;
  if (!appointment?.enabled || !appointment.calendar_event_id) {
    return { routine_key: routineKey, action: 'no_change', applied: false };
  }

  const fetched = await gcalGet(appointment.calendar_event_id);

  let parsedEvent: { start: Date | null } | 'gone' | null;
  if (fetched === null || fetched === 'gone') {
    parsedEvent = fetched;
  } else {
    const startIso = fetched.start?.dateTime ?? fetched.start?.date ?? null;
    parsedEvent = { start: startIso ? new Date(startIso) : null };
  }

  const outcome = diffAppointment({
    current: {
      calendar_event_id: appointment.calendar_event_id ?? null,
      last_event_start: appointment.last_event_start
        ? new Date(appointment.last_event_start as unknown as string)
        : null,
      last_done: routine.last_done
        ? new Date(routine.last_done as unknown as string)
        : null,
    },
    event: parsedEvent,
  });

  if (outcome.action === 'no_change') {
    // Still bump synced_at so we know the cron ran.
    await Routine.updateOne(
      { key: routineKey },
      { $set: { 'appointment.last_synced_at': new Date() } },
    );
    return { routine_key: routineKey, action: 'no_change', applied: true };
  }

  const set: Record<string, unknown> = {
    'appointment.last_synced_at': new Date(),
  };
  if (outcome.new_calendar_event_id !== undefined) {
    set['appointment.calendar_event_id'] = outcome.new_calendar_event_id;
  }
  if (outcome.new_last_event_start !== undefined) {
    set['appointment.last_event_start'] = outcome.new_last_event_start;
  }
  if (outcome.new_last_done !== undefined) {
    set['last_done'] = outcome.new_last_done;
  }

  await Routine.updateOne({ key: routineKey }, { $set: set });

  if (outcome.action === 'rescheduled') {
    await logActivity(
      'appointment_rescheduled',
      `Appointment moved for "${routine.name}"`,
      {
        actor: 'system',
        metadata: {
          routine_key: routineKey,
          from: isoOrNull(appointment.last_event_start
            ? new Date(appointment.last_event_start as unknown as string)
            : null),
          to: isoOrNull(outcome.new_last_event_start ?? null),
        },
      },
    );
  } else if (outcome.action === 'deleted') {
    await logActivity(
      'appointment_deleted_externally',
      `Appointment cleared for "${routine.name}" (removed from Google Calendar)`,
      {
        actor: 'system',
        metadata: { routine_key: routineKey },
      },
    );
  } else if (outcome.action === 'past_completed') {
    await logActivity(
      'task_done',
      `Auto-marked "${routine.name}" done from past appointment`,
      {
        actor: 'system',
        metadata: {
          routine_key: routineKey,
          completed_at: isoOrNull(outcome.new_last_done ?? null),
          source: 'calendar_reconcile',
        },
      },
    );
  }

  return { routine_key: routineKey, action: outcome.action, applied: true };
}

export async function reconcileAllAppointments(): Promise<ReconcileResult[]> {
  const routines = await Routine.find({
    'appointment.enabled': true,
    'appointment.calendar_event_id': { $ne: null },
  }).lean();
  const results: ReconcileResult[] = [];
  for (const r of routines) {
    try {
      results.push(await reconcileAppointment(r.key));
    } catch (err) {
      console.error(`[appointments] reconcile ${r.key} failed`, err);
      results.push({
        routine_key: r.key,
        action: 'no_change',
        applied: false,
      });
    }
  }
  return results;
}

/**
 * Clears the calendar link from the routine without deleting the Calendar
 * event itself. Used when Diane wants to detach the system from a particular
 * occurrence (e.g. moved it to a different routine).
 */
export async function clearAppointmentLink(
  routineKey: string,
): Promise<RoutineType | null> {
  const updated = await Routine.findOneAndUpdate(
    { key: routineKey },
    {
      $set: {
        'appointment.calendar_event_id': null,
        'appointment.last_event_start': null,
        'appointment.last_synced_at': new Date(),
      },
    },
    { new: true },
  ).lean();
  return (updated as unknown as RoutineType) ?? null;
}
