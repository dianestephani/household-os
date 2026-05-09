import { describe, it, expect } from 'vitest';
import { Routine } from '../db/models/Routine.js';
import { DeferralEvent } from '../db/models/DeferralEvent.js';
import { generateTodayPlan } from './morning-gen.js';

const TODAY = new Date(2026, 4, 12); // Tue 2026-05-12

describe('morning-gen — auto deferral logging', () => {
  it('writes a DeferralEvent with reason=over_budget for each overflow item', async () => {
    // 3 × 30min routines on a 45min day → 1 fits, 2 overflow.
    for (let i = 0; i < 3; i++) {
      await Routine.create({
        key: `task_${i}`,
        name: `Task ${i}`,
        category: 'cleaning',
        zone: 'common',
        scheduling: { type: 'rolling', interval_days: 1, flex_days: 0 },
        estimate_minutes: 30,
        energy: 'low',
        active: true,
      });
    }

    await generateTodayPlan(TODAY);
    const events = await DeferralEvent.find({}).lean();
    expect(events.length).toBe(2);
    for (const e of events) {
      expect(e.reason).toBe('over_budget');
      expect(e.source).toBe('auto');
    }
  });

  it('does not write any DeferralEvent if everything fits', async () => {
    await Routine.create({
      key: 'small_task',
      name: 'Small',
      category: 'cleaning',
      zone: 'common',
      scheduling: { type: 'rolling', interval_days: 1, flex_days: 0 },
      estimate_minutes: 10,
      energy: 'low',
      active: true,
    });
    await generateTodayPlan(TODAY);
    const events = await DeferralEvent.find({}).lean();
    expect(events.length).toBe(0);
  });
});
