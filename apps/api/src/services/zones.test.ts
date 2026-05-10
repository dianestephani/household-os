import { describe, it, expect } from 'vitest';
import { AdHocTask } from '../db/models/AdHocTask.js';
import { ZoneAssessment } from '../db/models/ZoneAssessment.js';
import {
  cancelAdHocTask,
  createAdHocTask,
  latestAssessmentByZone,
  listOpenAdHocTasks,
  markAdHocTaskDone,
  pickNextZone,
  recordAssessment,
  splitTaskNotes,
  ZONES,
} from './zones.js';
import { ActivityLog } from '../db/models/ActivityLog.js';

describe('pickNextZone', () => {
  it('returns a never-assessed zone first', async () => {
    await ZoneAssessment.create({
      ts: new Date(),
      zone: 'kitchen',
      level: 'fine',
    });
    const next = await pickNextZone();
    expect(next).not.toBe('kitchen');
    expect(ZONES).toContain(next);
  });

  it('returns the least-recently assessed when all have been seen', async () => {
    const oldest = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const newer = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
    for (const z of ZONES) {
      await ZoneAssessment.create({
        ts: z === 'yard' ? oldest : newer,
        zone: z,
        level: 'fine',
      });
    }
    const next = await pickNextZone();
    expect(next).toBe('yard');
  });
});

describe('recordAssessment', () => {
  it("doesn't create any tasks for level=fine", async () => {
    const { tasks } = await recordAssessment('kitchen', 'fine', 'looks great');
    expect(tasks).toEqual([]);
    const stored = await ZoneAssessment.findOne({}).lean();
    expect(stored?.level).toBe('fine');
  });

  it('creates an open AdHocTask using notes as the name when provided (single item)', async () => {
    const { tasks } = await recordAssessment('bathrooms', 'rough', 'sink + toilet');
    expect(tasks.length).toBe(1);
    const task = tasks[0]!;
    expect(task.name).toBe('sink + toilet');
    expect(task.severity).toBe('rough');
    expect(task.energy).toBe('high');
    expect(task.estimate_minutes).toBe(25);
    expect(task.status).toBe('open');
  });

  it('falls back to a default name when notes are empty', async () => {
    const { tasks } = await recordAssessment('kitchen', 'meh', '');
    expect(tasks.length).toBe(1);
    const task = tasks[0]!;
    expect(task.name).toMatch(/kitchen/i);
    expect(task.severity).toBe('meh');
    expect(task.energy).toBe('medium');
  });

  it('links every created task back to its source assessment', async () => {
    const { assessment, tasks } = await recordAssessment(
      'common',
      'rough',
      'dust',
    );
    expect(tasks.length).toBe(1);
    const task = tasks[0]!;
    expect(task.source_assessment_id).toBeDefined();
    expect(String(task.source_assessment_id)).toBe(String(assessment._id));
  });
});

describe('listOpenAdHocTasks + lifecycle', () => {
  it('lists only open tasks', async () => {
    const a = await AdHocTask.create({
      zone: 'kitchen',
      name: 'a',
      source: 'zone_assessment',
      severity: 'rough',
      estimate_minutes: 25,
      energy: 'high',
      status: 'open',
    });
    await AdHocTask.create({
      zone: 'kitchen',
      name: 'b',
      source: 'zone_assessment',
      severity: 'rough',
      estimate_minutes: 25,
      energy: 'high',
      status: 'cancelled',
    });
    await AdHocTask.create({
      zone: 'kitchen',
      name: 'c',
      source: 'zone_assessment',
      severity: 'rough',
      estimate_minutes: 25,
      energy: 'high',
      status: 'done',
    });
    const open = await listOpenAdHocTasks();
    expect(open.length).toBe(1);
    expect(String(open[0]?._id)).toBe(a.id);
  });

  it('cancelAdHocTask flips status to cancelled', async () => {
    const t = await AdHocTask.create({
      zone: 'kitchen',
      name: 'mop',
      source: 'zone_assessment',
      severity: 'meh',
      estimate_minutes: 15,
      energy: 'medium',
      status: 'open',
    });
    const result = await cancelAdHocTask(t.id);
    expect(result?.status).toBe('cancelled');
  });

  it('markAdHocTaskDone flips status to done with timestamp', async () => {
    const t = await AdHocTask.create({
      zone: 'kitchen',
      name: 'mop',
      source: 'zone_assessment',
      severity: 'meh',
      estimate_minutes: 15,
      energy: 'medium',
      status: 'open',
    });
    const result = await markAdHocTaskDone(t.id);
    expect(result?.status).toBe('done');
    expect(result?.done_at).toBeTruthy();
  });
});

describe('latestAssessmentByZone', () => {
  it('returns the most recent per zone', async () => {
    const old = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    await ZoneAssessment.create({ ts: old, zone: 'kitchen', level: 'meh' });
    await new Promise((r) => setTimeout(r, 5));
    await ZoneAssessment.create({ ts: new Date(), zone: 'kitchen', level: 'fine' });
    await ZoneAssessment.create({ ts: new Date(), zone: 'yard', level: 'rough' });
    const latest = await latestAssessmentByZone();
    expect(latest.kitchen?.level).toBe('fine');
    expect(latest.yard?.level).toBe('rough');
    expect(latest.bathrooms).toBeUndefined();
  });
});

describe('createAdHocTask', () => {
  it('creates a task with sensible defaults from a name only', async () => {
    const task = await createAdHocTask({ name: 'call the vet' });
    expect(task.name).toBe('call the vet');
    expect(task.zone).toBe('whole-house');
    expect(task.severity).toBe('meh');
    expect(task.estimate_minutes).toBe(15); // meh default
    expect(task.energy).toBe('medium');
    expect(task.status).toBe('open');
    expect(task.source).toBe('manual');
  });

  it('honors caller-supplied zone / severity / source', async () => {
    const task = await createAdHocTask({
      name: 'scrub the shower',
      zone: 'bathrooms',
      severity: 'rough',
      source: 'voice',
    });
    expect(task.zone).toBe('bathrooms');
    expect(task.severity).toBe('rough');
    expect(task.estimate_minutes).toBe(25); // rough default
    expect(task.energy).toBe('high');
    expect(task.source).toBe('voice');
  });

  it('trims whitespace and rejects empty names', async () => {
    await expect(createAdHocTask({ name: '   ' })).rejects.toThrow(/required/);
    const task = await createAdHocTask({ name: '  yard cleanup  ' });
    expect(task.name).toBe('yard cleanup');
  });

  it('writes a task_created activity log entry', async () => {
    await createAdHocTask({ name: 'air filter replacement', source: 'voice' });
    const log = await ActivityLog.findOne({ kind: 'task_created' }).lean();
    expect(log).not.toBeNull();
    expect(log?.summary).toContain('air filter');
    expect(log?.metadata).toMatchObject({ source: 'voice' });
  });

  it('is picked up by listOpenAdHocTasks immediately', async () => {
    await createAdHocTask({ name: 'something new' });
    const open = await listOpenAdHocTasks();
    expect(open.find((t) => t.name === 'something new')).toBeDefined();
  });
});

describe('splitTaskNotes', () => {
  it('returns [] for null / undefined / empty / whitespace-only', () => {
    expect(splitTaskNotes(undefined)).toEqual([]);
    expect(splitTaskNotes(null)).toEqual([]);
    expect(splitTaskNotes('')).toEqual([]);
    expect(splitTaskNotes('    ')).toEqual([]);
    expect(splitTaskNotes(' , , ')).toEqual([]);
  });

  it('returns a single-element array for notes with no commas', () => {
    expect(splitTaskNotes('wipe counters')).toEqual(['wipe counters']);
    expect(splitTaskNotes('  wipe counters  ')).toEqual(['wipe counters']);
  });

  it('splits on commas and trims each segment', () => {
    expect(splitTaskNotes('wipe counters, sweep floor, take out trash')).toEqual([
      'wipe counters',
      'sweep floor',
      'take out trash',
    ]);
    expect(splitTaskNotes('a,b,c')).toEqual(['a', 'b', 'c']);
  });

  it('drops empty segments (consecutive commas, trailing comma)', () => {
    expect(splitTaskNotes('a,,b')).toEqual(['a', 'b']);
    expect(splitTaskNotes('a, , b')).toEqual(['a', 'b']);
    expect(splitTaskNotes('a, b,')).toEqual(['a', 'b']);
    expect(splitTaskNotes(',a,b')).toEqual(['a', 'b']);
  });

  it('only splits on commas — semicolons / newlines / slashes are preserved inside a segment', () => {
    expect(splitTaskNotes('a; b, c\nd')).toEqual(['a; b', 'c\nd']);
    expect(splitTaskNotes('kitchen/bathrooms, yard')).toEqual([
      'kitchen/bathrooms',
      'yard',
    ]);
  });
});

describe('recordAssessment — multi-task split on commas', () => {
  it('creates one open AdHocTask per comma-separated note item', async () => {
    const { tasks } = await recordAssessment(
      'kitchen',
      'rough',
      'wipe counters, sweep floor, take out trash',
    );
    expect(tasks.length).toBe(3);
    expect(tasks.map((t) => t.name)).toEqual([
      'wipe counters',
      'sweep floor',
      'take out trash',
    ]);
    // All tasks share the severity-derived defaults
    for (const t of tasks) {
      expect(t.severity).toBe('rough');
      expect(t.energy).toBe('high');
      expect(t.estimate_minutes).toBe(25);
      expect(t.status).toBe('open');
      expect(t.zone).toBe('kitchen');
    }
  });

  it('emits one task_created activity entry per task created', async () => {
    await recordAssessment('bathrooms', 'meh', 'scrub sink, mop floor');
    const events = await ActivityLog.find({ kind: 'task_created' })
      .sort({ ts: 1 })
      .lean();
    expect(events.length).toBe(2);
    expect(events.map((e) => e.summary)).toEqual([
      'Task added: "scrub sink"',
      'Task added: "mop floor"',
    ]);
  });

  it('links every task in the batch back to the same source assessment', async () => {
    const { assessment, tasks } = await recordAssessment(
      'common',
      'rough',
      'dust shelves, vacuum rug',
    );
    expect(tasks.length).toBe(2);
    const aid = String(assessment._id);
    for (const t of tasks) {
      expect(String(t.source_assessment_id)).toBe(aid);
    }
  });

  it('treats single-item notes as 1 task (regression — preserves prior behavior)', async () => {
    const { tasks } = await recordAssessment(
      'yard',
      'meh',
      'pick up branches',
    );
    expect(tasks.length).toBe(1);
    expect(tasks[0]?.name).toBe('pick up branches');
  });

  it('all-empty-segment notes fall through to the default-name fallback', async () => {
    // " , , " has no usable items → defaultTaskName fires
    const { tasks } = await recordAssessment('bedroom', 'meh', ' , , ');
    expect(tasks.length).toBe(1);
    expect(tasks[0]?.name).toMatch(/bedroom/i);
  });
});
