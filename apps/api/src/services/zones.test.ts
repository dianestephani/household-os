import { describe, it, expect } from 'vitest';
import { AdHocTask } from '../db/models/AdHocTask.js';
import { ZoneAssessment } from '../db/models/ZoneAssessment.js';
import {
  cancelAdHocTask,
  latestAssessmentByZone,
  listOpenAdHocTasks,
  markAdHocTaskDone,
  pickNextZone,
  recordAssessment,
  ZONES,
} from './zones.js';

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
  it("doesn't create a task for level=fine", async () => {
    const { task } = await recordAssessment('kitchen', 'fine', 'looks great');
    expect(task).toBeNull();
    const stored = await ZoneAssessment.findOne({}).lean();
    expect(stored?.level).toBe('fine');
  });

  it('creates an open AdHocTask using notes as the name when provided', async () => {
    const { task } = await recordAssessment('bathrooms', 'rough', 'sink + toilet');
    expect(task?.name).toBe('sink + toilet');
    expect(task?.severity).toBe('rough');
    expect(task?.energy).toBe('high');
    expect(task?.estimate_minutes).toBe(25);
    expect(task?.status).toBe('open');
  });

  it('falls back to a default name when notes are empty', async () => {
    const { task } = await recordAssessment('kitchen', 'meh', '');
    expect(task?.name).toMatch(/kitchen/i);
    expect(task?.severity).toBe('meh');
    expect(task?.energy).toBe('medium');
  });

  it('links the task back to its source assessment', async () => {
    const { assessment, task } = await recordAssessment(
      'common',
      'rough',
      'dust',
    );
    expect(task?.source_assessment_id).toBeDefined();
    expect(String(task?.source_assessment_id)).toBe(String(assessment._id));
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
