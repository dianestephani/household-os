import { describe, it, expect } from 'vitest';
import { ActivityLog } from '../db/models/ActivityLog.js';
import { Routine } from '../db/models/Routine.js';
import {
  clearAppointmentLink,
  createAppointment,
  diffAppointment,
  reconcileAllAppointments,
  reconcileAppointment,
} from './appointments.js';

const FIXED_NOW = new Date('2026-05-15T12:00:00Z');

function appointmentRoutine(
  key: string,
  appointment: Record<string, unknown> = {},
) {
  return {
    key,
    name: key.replace(/_/g, ' '),
    category: 'beauty',
    zone: 'self',
    scheduling: { type: 'rolling', interval_days: 42, flex_days: 0 },
    estimate_minutes: 60,
    energy: 'low',
    active: true,
    appointment: {
      enabled: true,
      default_duration_minutes: 60,
      ...appointment,
    },
  };
}

// =====================================================================
// diffAppointment — exhaustive pure-function tests
// =====================================================================

describe('diffAppointment — transient lookup failure', () => {
  it('returns no_change when fetch failed (event=null)', () => {
    const out = diffAppointment({
      current: {
        calendar_event_id: 'abc',
        last_event_start: new Date('2026-05-20T10:00:00Z'),
        last_done: null,
      },
      event: null,
      now: FIXED_NOW,
    });
    expect(out.action).toBe('no_change');
    expect(out.new_last_event_start).toBeUndefined();
    expect(out.new_last_done).toBeUndefined();
  });
});

describe('diffAppointment — event gone (deleted/cancelled)', () => {
  it('clears the link when event is gone and we still had one', () => {
    const out = diffAppointment({
      current: {
        calendar_event_id: 'abc',
        last_event_start: new Date('2026-05-20T10:00:00Z'),
        last_done: null,
      },
      event: 'gone',
      now: FIXED_NOW,
    });
    expect(out.action).toBe('deleted');
    expect(out.new_calendar_event_id).toBeNull();
    expect(out.new_last_event_start).toBeNull();
  });

  it('no_change when event is gone and we never had one', () => {
    const out = diffAppointment({
      current: {
        calendar_event_id: null,
        last_event_start: null,
        last_done: null,
      },
      event: 'gone',
      now: FIXED_NOW,
    });
    expect(out.action).toBe('no_change');
  });
});

describe('diffAppointment — past appointment auto-completes', () => {
  it('sets last_done from event.start when start is in the past and last_done is null', () => {
    const past = new Date('2026-05-14T10:00:00Z');
    const out = diffAppointment({
      current: {
        calendar_event_id: 'abc',
        last_event_start: past,
        last_done: null,
      },
      event: { start: past },
      now: FIXED_NOW,
    });
    expect(out.action).toBe('past_completed');
    expect(out.new_last_done?.toISOString()).toBe(past.toISOString());
    expect(out.new_last_event_start?.toISOString()).toBe(past.toISOString());
  });

  it('does NOT re-complete when last_done already covers the event', () => {
    const past = new Date('2026-05-14T10:00:00Z');
    const out = diffAppointment({
      current: {
        calendar_event_id: 'abc',
        last_event_start: past,
        last_done: new Date('2026-05-14T11:00:00Z'),
      },
      event: { start: past },
      now: FIXED_NOW,
    });
    expect(out.action).toBe('no_change');
  });
});

describe('diffAppointment — reschedule detection', () => {
  it('records new start time when user moved the event', () => {
    const out = diffAppointment({
      current: {
        calendar_event_id: 'abc',
        last_event_start: new Date('2026-05-20T10:00:00Z'),
        last_done: null,
      },
      event: { start: new Date('2026-05-22T14:00:00Z') },
      now: FIXED_NOW,
    });
    expect(out.action).toBe('rescheduled');
    expect(out.new_last_event_start?.toISOString()).toBe(
      '2026-05-22T14:00:00.000Z',
    );
  });

  it('treats first-time scheduling (last_event_start was null) as rescheduled', () => {
    const out = diffAppointment({
      current: {
        calendar_event_id: 'abc',
        last_event_start: null,
        last_done: null,
      },
      event: { start: new Date('2026-05-22T14:00:00Z') },
      now: FIXED_NOW,
    });
    expect(out.action).toBe('rescheduled');
  });

  it('no_change when start matches what we already stored', () => {
    const start = new Date('2026-05-22T14:00:00Z');
    const out = diffAppointment({
      current: {
        calendar_event_id: 'abc',
        last_event_start: start,
        last_done: null,
      },
      event: { start },
      now: FIXED_NOW,
    });
    expect(out.action).toBe('no_change');
  });
});

describe('diffAppointment — past_completed takes precedence over reschedule', () => {
  it('a past start with different last_event_start still routes to past_completed', () => {
    const out = diffAppointment({
      current: {
        calendar_event_id: 'abc',
        last_event_start: new Date('2026-05-14T08:00:00Z'),
        last_done: null,
      },
      event: { start: new Date('2026-05-14T10:00:00Z') }, // different time, but still past
      now: FIXED_NOW,
    });
    expect(out.action).toBe('past_completed');
    expect(out.new_last_done?.toISOString()).toBe('2026-05-14T10:00:00.000Z');
  });
});

// =====================================================================
// I/O wrappers — Mongo side; Calendar API is no-op in NODE_ENV=test
// =====================================================================

describe('createAppointment', () => {
  it('persists appointment fields and logs appointment_created', async () => {
    await Routine.create(appointmentRoutine('head_spa'));
    const result = await createAppointment({
      routine_key: 'head_spa',
      starts_at: '2026-06-15T15:00:00Z',
      duration_minutes: 90,
    });
    expect(result.calendar_skipped).toBe(true); // test mode → no real event
    expect(result.routine.appointment?.enabled).toBe(true);
    expect(new Date(result.routine.appointment!.last_event_start as string).toISOString()).toBe(
      '2026-06-15T15:00:00.000Z',
    );

    const entry = await ActivityLog.findOne({
      kind: 'appointment_created',
    }).lean();
    expect(entry).toBeTruthy();
    const meta = entry?.metadata as {
      routine_key?: string;
      duration_minutes?: number;
      calendar_skipped?: boolean;
    };
    expect(meta?.routine_key).toBe('head_spa');
    expect(meta?.duration_minutes).toBe(90);
    expect(meta?.calendar_skipped).toBe(true);
  });

  it('falls back to default_duration_minutes when not provided', async () => {
    await Routine.create(
      appointmentRoutine('head_spa', { default_duration_minutes: 75 }),
    );
    const result = await createAppointment({
      routine_key: 'head_spa',
      starts_at: '2026-06-15T15:00:00Z',
    });
    expect(result.duration_minutes).toBe(75);
  });

  it('throws when routine does not exist', async () => {
    await expect(
      createAppointment({
        routine_key: 'ghost',
        starts_at: '2026-06-15T15:00:00Z',
      }),
    ).rejects.toThrow(/not found/);
  });

  it('throws when routine is not appointment-enabled', async () => {
    await Routine.create({
      key: 'litter_scoop',
      name: 'Scoop litter',
      category: 'pet',
      zone: 'bathrooms',
      scheduling: { type: 'rolling', interval_days: 1, flex_days: 0 },
      estimate_minutes: 8,
      energy: 'low',
      active: true,
      // no appointment field
    });
    await expect(
      createAppointment({
        routine_key: 'litter_scoop',
        starts_at: '2026-06-15T15:00:00Z',
      }),
    ).rejects.toThrow(/appointment-enabled/);
  });

  it('throws on invalid starts_at', async () => {
    await Routine.create(appointmentRoutine('head_spa'));
    await expect(
      createAppointment({
        routine_key: 'head_spa',
        starts_at: 'not-a-date',
      }),
    ).rejects.toThrow(/starts_at/);
  });
});

describe('reconcileAppointment + reconcileAllAppointments', () => {
  it('skips routines that have no appointment.enabled', async () => {
    await Routine.create({
      key: 'litter_scoop',
      name: 'Scoop litter',
      category: 'pet',
      zone: 'bathrooms',
      scheduling: { type: 'rolling', interval_days: 1, flex_days: 0 },
      estimate_minutes: 8,
      energy: 'low',
      active: true,
    });
    const r = await reconcileAppointment('litter_scoop');
    expect(r.applied).toBe(false);
    expect(r.action).toBe('no_change');
  });

  it('only iterates appointment-enabled + linked routines', async () => {
    // Enabled + linked → eligible
    await Routine.create(
      appointmentRoutine('head_spa', { calendar_event_id: 'evt1' }),
    );
    // Enabled but not linked → skipped
    await Routine.create(
      appointmentRoutine('haircut', { calendar_event_id: null }),
    );
    // Not enabled → skipped
    await Routine.create({
      key: 'litter_scoop',
      name: 'Scoop litter',
      category: 'pet',
      zone: 'bathrooms',
      scheduling: { type: 'rolling', interval_days: 1, flex_days: 0 },
      estimate_minutes: 8,
      energy: 'low',
      active: true,
    });

    const results = await reconcileAllAppointments();
    const keys = results.map((r) => r.routine_key);
    expect(keys).toEqual(['head_spa']);
  });
});

describe('clearAppointmentLink', () => {
  it('clears link fields without touching enabled flag', async () => {
    await Routine.create(
      appointmentRoutine('head_spa', {
        calendar_event_id: 'evt1',
        last_event_start: new Date('2026-06-15T15:00:00Z'),
      }),
    );
    const updated = await clearAppointmentLink('head_spa');
    expect(updated?.appointment?.enabled).toBe(true);
    expect(updated?.appointment?.calendar_event_id ?? null).toBeNull();
    expect(updated?.appointment?.last_event_start ?? null).toBeNull();
  });

  it('returns null when routine does not exist', async () => {
    const r = await clearAppointmentLink('ghost');
    expect(r).toBeNull();
  });
});
