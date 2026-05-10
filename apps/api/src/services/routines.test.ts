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
  scheduling: { type: 'rolling', interval_days: 7, flex_days: 1 },
  estimate_minutes: 10,
  energy: 'low',
  active: true,
};

describe('patchRoutine — allow-list', () => {
  it('applies fields that are on the allow-list', async () => {
    await Routine.create(BASE_ROUTINE);
    const updated = await patchRoutine('test_routine', {
      name: 'Renamed',
      estimate_minutes: 25,
      energy: 'medium',
      active: false,
    });
    expect(updated?.name).toBe('Renamed');
    expect(updated?.estimate_minutes).toBe(25);
    expect(updated?.energy).toBe('medium');
    expect(updated?.active).toBe(false);
  });

  it('silently drops fields not on the allow-list', async () => {
    await Routine.create(BASE_ROUTINE);
    await patchRoutine('test_routine', {
      name: 'Allowed',
      // These are NOT on the allow-list — must be ignored:
      key: 'sneaky_rename',
      _id: '000000000000000000000000',
      outsourceable: true,
      outsource_cost_estimate: 999,
    } as Record<string, unknown>);

    const after = await getRoutine('test_routine');
    expect(after?.name).toBe('Allowed');
    expect(after?.key).toBe('test_routine'); // key not overwritten
    // outsourceable/outsource_cost_estimate aren't on the allow-list so the
    // schema defaults stay in place.
    expect(after?.outsourceable).toBe(false);
    expect(after?.outsource_cost_estimate).toBe(0);
  });

  it('supports patching the nested scheduling object', async () => {
    await Routine.create(BASE_ROUTINE);
    await patchRoutine('test_routine', {
      scheduling: { type: 'rolling', interval_days: 14, flex_days: 2 },
    });
    const after = await getRoutine('test_routine');
    expect(after?.scheduling?.interval_days).toBe(14);
    expect(after?.scheduling?.flex_days).toBe(2);
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
