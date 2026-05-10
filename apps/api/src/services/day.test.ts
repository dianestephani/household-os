import { describe, it, expect } from 'vitest';
import { TodayPlan } from '../db/models/TodayPlan.js';
import { Routine } from '../db/models/Routine.js';
import { ContextEntry } from '../db/models/ContextEntry.js';
import { getDayView } from './day.js';
import { addDays, ymd } from '../utils/dates.js';

describe('getDayView — today', () => {
  it('auto-creates a TodayPlan if morning-gen has not run yet', async () => {
    const today = ymd(new Date());
    const view = await getDayView(today);
    expect(view.is_today).toBe(true);
    expect(view.is_past).toBe(false);
    expect(view.is_future).toBe(false);
    expect(view.plan).not.toBeNull();
    expect(view.plan?.date).toBe(today);
    // Forecast is suppressed for today — plan is the source of truth.
    expect(view.forecast).toEqual([]);
  });

  it('returns the existing TodayPlan when one is already stored', async () => {
    const today = ymd(new Date());
    await TodayPlan.create({
      date: today,
      day_type: 'weekday_default',
      budget_minutes: 45,
      current_energy: 'high',
      items: [],
      swap_pool: [],
      publisher: {},
    });
    const view = await getDayView(today);
    expect(view.plan?.current_energy).toBe('high');
  });
});

describe('getDayView — past', () => {
  it('returns the stored plan for a past date', async () => {
    const yesterday = ymd(addDays(new Date(), -1));
    await TodayPlan.create({
      date: yesterday,
      day_type: 'weekday_default',
      budget_minutes: 45,
      current_energy: 'medium',
      items: [
        {
          routine_key: 'litter_scoop',
          name: 'Litter',
          estimate_minutes: 8,
          energy: 'low',
          status: 'done',
          order: 0,
        },
      ],
      swap_pool: [],
      publisher: {},
    });
    const view = await getDayView(yesterday);
    expect(view.is_past).toBe(true);
    expect(view.plan?.items.length).toBe(1);
    expect(view.plan?.items[0]?.status).toBe('done');
    expect(view.forecast).toEqual([]);
  });

  it('returns null plan + empty forecast when nothing was stored', async () => {
    const yesterday = ymd(addDays(new Date(), -1));
    const view = await getDayView(yesterday);
    expect(view.plan).toBeNull();
    expect(view.forecast).toEqual([]);
  });
});

describe('getDayView — future', () => {
  it('synthesizes a forecast from rolling routines, no plan', async () => {
    const future = ymd(addDays(new Date(), 3));
    await Routine.create({
      key: 'mid',
      name: 'Mid routine',
      category: 'cleaning',
      zone: 'whole-house',
      scheduling: { type: 'rolling', interval_days: 3, flex_days: 0 },
      estimate_minutes: 10,
      energy: 'low',
      active: true,
      // last_done = now → next_due = now+3 → bucketed on `future`
      last_done: new Date(),
    });
    const view = await getDayView(future);
    expect(view.is_future).toBe(true);
    expect(view.plan).toBeNull();
    const keys = view.forecast.map((r) => r.routine_key);
    expect(keys).toContain('mid');
  });
});

describe('getDayView — events + context', () => {
  it("returns only context entries that fall within that day's local window", async () => {
    const today = ymd(new Date());
    const yesterday = ymd(addDays(new Date(), -1));
    await ContextEntry.create({
      ts: new Date(),
      text: 'today entry',
      related_persona: 'both',
      source: 'api',
    });
    await ContextEntry.create({
      ts: addDays(new Date(), -1),
      text: 'yesterday entry',
      related_persona: 'both',
      source: 'api',
    });

    const todayView = await getDayView(today);
    expect(todayView.context.map((c) => c.text)).toEqual(['today entry']);

    const yesterdayView = await getDayView(yesterday);
    expect(yesterdayView.context.map((c) => c.text)).toEqual(['yesterday entry']);
  });

  it('returns calendar_connected=false (test mode) → empty events', async () => {
    const today = ymd(new Date());
    const view = await getDayView(today);
    expect(view.events).toEqual([]);
  });
});
