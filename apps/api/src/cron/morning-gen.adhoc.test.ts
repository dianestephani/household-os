import { describe, it, expect } from 'vitest';
import { AdHocTask } from '../db/models/AdHocTask.js';
import { TodayPlan } from '../db/models/TodayPlan.js';
import { generateTodayPlan } from './morning-gen.js';
import { adHocKeyFor, ADHOC_PREFIX } from '../services/zones.js';

const TODAY = new Date(2026, 4, 9); // Saturday — day_off, big budget

describe('morning-gen — AdHocTask integration', () => {
  it('pulls open AdHocTasks into the candidate list and prefixes routine_key with adhoc_', async () => {
    const t = await AdHocTask.create({
      zone: 'kitchen',
      name: 'wipe counters',
      source: 'zone_assessment',
      severity: 'rough',
      estimate_minutes: 20,
      energy: 'high',
      status: 'open',
    });

    const { planId } = await generateTodayPlan(TODAY);
    const plan = await TodayPlan.findById(planId);
    const all = [
      ...(plan?.items ?? []).map((i) => i.routine_key),
      ...(plan?.swap_pool ?? []).map((p) => p.routine_key),
    ];
    expect(all).toContain(adHocKeyFor(t.id));
  });

  it('rough beats meh in priority order', async () => {
    await AdHocTask.create({
      zone: 'kitchen',
      name: 'rough task',
      source: 'zone_assessment',
      severity: 'rough',
      estimate_minutes: 10,
      energy: 'medium',
      status: 'open',
    });
    await AdHocTask.create({
      zone: 'bathrooms',
      name: 'meh task',
      source: 'zone_assessment',
      severity: 'meh',
      estimate_minutes: 10,
      energy: 'medium',
      status: 'open',
    });

    const { planId } = await generateTodayPlan(TODAY);
    const plan = await TodayPlan.findById(planId);
    const adhocItems = (plan?.items ?? []).filter((i) =>
      i.routine_key.startsWith(ADHOC_PREFIX),
    );
    expect(adhocItems.length).toBe(2);
    expect(adhocItems[0]?.name).toBe('rough task');
    expect(adhocItems[1]?.name).toBe('meh task');
  });

  it('done AdHocTasks are not pulled in', async () => {
    await AdHocTask.create({
      zone: 'kitchen',
      name: 'already done',
      source: 'zone_assessment',
      severity: 'rough',
      estimate_minutes: 20,
      energy: 'high',
      status: 'done',
    });
    const { planId } = await generateTodayPlan(TODAY);
    const plan = await TodayPlan.findById(planId);
    const all = [
      ...(plan?.items ?? []).map((i) => i.name),
      ...(plan?.swap_pool ?? []).map((p) => p.name),
    ];
    expect(all).not.toContain('already done');
  });
});
