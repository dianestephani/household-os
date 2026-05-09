import { describe, it, expect } from 'vitest';
import { AdHocTask } from '../db/models/AdHocTask.js';
import { TodayPlan } from '../db/models/TodayPlan.js';
import { ymd } from '../utils/dates.js';
import { adHocKeyFor } from './zones.js';
import { markDone } from './today.js';

describe('markDone — AdHocTask routing', () => {
  it('marks the AdHocTask done, not a Routine', async () => {
    const task = await AdHocTask.create({
      zone: 'kitchen',
      name: 'wipe',
      source: 'zone_assessment',
      severity: 'meh',
      estimate_minutes: 15,
      energy: 'medium',
      status: 'open',
    });
    const key = adHocKeyFor(task.id);
    await TodayPlan.create({
      date: ymd(new Date()),
      day_type: 'weekday_default',
      budget_minutes: 45,
      current_energy: 'medium',
      items: [
        {
          routine_key: key,
          name: 'wipe',
          estimate_minutes: 15,
          energy: 'medium',
          status: 'pending',
          order: 0,
        },
      ],
      swap_pool: [],
      publisher: {},
    });

    await markDone(key);

    const after = await AdHocTask.findById(task.id);
    expect(after?.status).toBe('done');
    expect(after?.done_at).toBeTruthy();
  });
});
