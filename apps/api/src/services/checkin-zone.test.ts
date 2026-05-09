import { describe, it, expect } from 'vitest';
import { AdHocTask } from '../db/models/AdHocTask.js';
import { CheckIn } from '../db/models/CheckIn.js';
import { ZoneAssessment } from '../db/models/ZoneAssessment.js';
import { generateZoneAssessment } from './checkin-generators.js';
import { answerCheckIn } from './checkins.js';

describe('generateZoneAssessment', () => {
  it('creates a check-in with zone in context + 2 questions', async () => {
    const ck = await generateZoneAssessment();
    expect(ck?.type).toBe('zone_assessment');
    expect(ck?.context?.kind).toBe('zone_assessment');
    expect(ck?.questions.length).toBe(2);
    const ids = (ck?.questions ?? []).map((q) => q.id);
    expect(ids).toContain('zone_state');
    expect(ids).toContain('zone_notes');
  });

  it('is idempotent for the same calendar day', async () => {
    await generateZoneAssessment();
    await generateZoneAssessment();
    const all = await CheckIn.find({ type: 'zone_assessment' }).lean();
    expect(all.length).toBe(1);
  });
});

describe('answerCheckIn — zone_assessment side-effects', () => {
  it('records ZoneAssessment + creates AdHocTask when level=rough with notes', async () => {
    const ck = await generateZoneAssessment();
    if (!ck) throw new Error('check-in not created');
    // Force the zone for a deterministic assertion
    await CheckIn.updateOne(
      { _id: ck._id },
      { $set: { 'context.zone': 'kitchen' } },
    );
    await answerCheckIn(String(ck._id), {
      zone_state: 'rough',
      zone_notes: 'counters + microwave',
    });

    const assessments = await ZoneAssessment.find({}).lean();
    expect(assessments.length).toBe(1);
    expect(assessments[0]?.level).toBe('rough');
    expect(assessments[0]?.zone).toBe('kitchen');

    const tasks = await AdHocTask.find({}).lean();
    expect(tasks.length).toBe(1);
    expect(tasks[0]?.name).toBe('counters + microwave');
    expect(tasks[0]?.severity).toBe('rough');
  });

  it('does NOT create an AdHocTask when level=fine', async () => {
    const ck = await generateZoneAssessment();
    if (!ck) throw new Error('check-in not created');
    await answerCheckIn(String(ck._id), {
      zone_state: 'fine',
    });
    const tasks = await AdHocTask.find({}).lean();
    expect(tasks.length).toBe(0);
    const assessments = await ZoneAssessment.find({}).lean();
    expect(assessments.length).toBe(1);
  });

  it('uses default task name when notes are empty (level=meh|rough)', async () => {
    const ck = await generateZoneAssessment();
    if (!ck) throw new Error('check-in not created');
    await CheckIn.updateOne(
      { _id: ck._id },
      { $set: { 'context.zone': 'yard' } },
    );
    await answerCheckIn(String(ck._id), {
      zone_state: 'meh',
    });
    const task = await AdHocTask.findOne({}).lean();
    expect(task?.name).toMatch(/yard/i);
  });
});
