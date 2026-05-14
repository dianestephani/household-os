import { describe, it, expect } from 'vitest';
import { Routine } from '../db/models/Routine.js';
import {
  createRoutine,
  getRoutine,
  listRoutines,
  patchRoutine,
  softDeleteRoutine,
} from './routines.js';

const BASE_ROUTINE = {
  key: 'test_routine',
  name: 'Test routine',
  category: 'cleaning',
  zone: 'kitchen',
  scheduling: { type: 'rolling', interval_days: 7 },
  estimate_minutes: 10,
  active: true,
};

describe('patchRoutine — allow-list', () => {
  it('applies fields that are on the allow-list', async () => {
    await Routine.create(BASE_ROUTINE);
    const updated = await patchRoutine('test_routine', {
      name: 'Renamed',
      estimate_minutes: 25,
      active: false,
    });
    expect(updated?.name).toBe('Renamed');
    expect(updated?.estimate_minutes).toBe(25);
    expect(updated?.active).toBe(false);
  });

  it('silently drops fields not on the allow-list', async () => {
    await Routine.create(BASE_ROUTINE);
    await patchRoutine('test_routine', {
      name: 'Allowed',
      // These are NOT on the allow-list — must be ignored:
      key: 'sneaky_rename',
      _id: '000000000000000000000000',
      // §50 Phase E — `energy` retired from the schema, also not on the
      // allow-list anymore. Make sure it's still silently dropped.
      energy: 'high',
    } as Record<string, unknown>);

    const after = await getRoutine('test_routine');
    expect(after?.name).toBe('Allowed');
    expect(after?.key).toBe('test_routine'); // key not overwritten
  });

  it('outsourceable + outsource_cost_estimate + monthly_occurrences_override ARE on the allow-list', async () => {
    // §50 Phase E added monthly_occurrences_override + opened outsourceable to
    // patching (it was off the allow-list before but needed for the Finance
    // module's listOutsourceable math).
    await Routine.create(BASE_ROUTINE);
    await patchRoutine('test_routine', {
      outsourceable: true,
      outsource_cost_estimate: 250,
      monthly_occurrences_override: 1,
    });
    const after = await getRoutine('test_routine');
    expect(after?.outsourceable).toBe(true);
    expect(after?.outsource_cost_estimate).toBe(250);
    expect(after?.monthly_occurrences_override).toBe(1);
  });

  it('supports patching the nested scheduling object', async () => {
    await Routine.create(BASE_ROUTINE);
    await patchRoutine('test_routine', {
      scheduling: { type: 'rolling', interval_days: 14 },
    });
    const after = await getRoutine('test_routine');
    expect(after?.scheduling?.interval_days).toBe(14);
  });

  it('skip_one cadence_shift_strategy clears the linked appointment', async () => {
    await Routine.create({
      ...BASE_ROUTINE,
      key: 'haircut',
      appointment: {
        enabled: true,
        calendar_event_id: 'evt_abc',
        last_event_start: new Date('2026-05-20T17:00:00Z'),
        default_duration_minutes: 60,
      },
    });
    await patchRoutine(
      'haircut',
      { scheduling: { type: 'rolling', interval_days: 42 } },
      { cadence_shift_strategy: 'skip_one' },
    );
    const after = await getRoutine('haircut');
    expect(after?.appointment?.calendar_event_id).toBeFalsy();
    expect(after?.appointment?.last_event_start).toBeFalsy();
    // appointment.enabled should NOT be touched — the routine is still
    // appointment-style, she just skipped this booking.
    expect(after?.appointment?.enabled).toBe(true);
  });

  it('updating last_done is allowed (used by start-tomorrow + mark-done)', async () => {
    await Routine.create(BASE_ROUTINE);
    const ts = new Date('2026-05-01T00:00:00.000Z');
    await patchRoutine('test_routine', { last_done: ts });
    const after = await getRoutine('test_routine');
    expect(new Date(after!.last_done as Date).toISOString()).toBe(ts.toISOString());
  });
});

describe('listRoutines', () => {
  it('returns only active routines by default', async () => {
    await Routine.create({ ...BASE_ROUTINE, key: 'one' });
    await Routine.create({ ...BASE_ROUTINE, key: 'two', active: false });
    const list = await listRoutines();
    const keys = list.map((r) => r.key);
    expect(keys).toContain('one');
    expect(keys).not.toContain('two');
  });

  it('filters by category', async () => {
    await Routine.create({ ...BASE_ROUTINE, key: 'a', category: 'pet' });
    await Routine.create({ ...BASE_ROUTINE, key: 'b', category: 'cleaning' });
    const pet = await listRoutines({ category: 'pet' });
    expect(pet.map((r) => r.key)).toEqual(['a']);
  });

  it('filters by zone', async () => {
    await Routine.create({ ...BASE_ROUTINE, key: 'a', zone: 'kitchen' });
    await Routine.create({ ...BASE_ROUTINE, key: 'b', zone: 'bedroom' });
    const bedroom = await listRoutines({ zone: 'bedroom' });
    expect(bedroom.map((r) => r.key)).toEqual(['b']);
  });
});

describe('softDeleteRoutine', () => {
  it('flips active=false without removing the doc', async () => {
    await Routine.create(BASE_ROUTINE);
    const result = await softDeleteRoutine('test_routine');
    expect(result).toEqual({ key: 'test_routine', active: false });
    const doc = await Routine.findOne({ key: 'test_routine' }).lean();
    expect(doc).not.toBeNull();
    expect(doc?.active).toBe(false);
  });
});

describe('createRoutine', () => {
  it('persists a routine and is findable by key', async () => {
    await createRoutine({ ...BASE_ROUTINE, key: 'fresh' });
    const found = await getRoutine('fresh');
    expect(found?.name).toBe('Test routine');
  });
});
