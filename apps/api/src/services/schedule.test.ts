import { describe, it, expect } from 'vitest';
import { Routine } from '../db/models/Routine.js';
import { Trigger } from '../db/models/Trigger.js';
import { AdHocTask } from '../db/models/AdHocTask.js';
import { scheduleRange } from './schedule.js';
import { addDays, parseYmd } from '../utils/dates.js';
import type { ScheduleEntry } from '@household-os/shared/types';

const NOW = new Date(2026, 4, 9, 12); // 2026-05-09 (Saturday) noon, local
const ymdOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dowOf = (d: ScheduleEntry) => parseYmd(d.date).getDay();

function findDay(days: ScheduleEntry[], date: Date): ScheduleEntry | undefined {
  return days.find((d) => d.date === ymdOf(date));
}

describe('scheduleRange — rolling routines', () => {
  it('never-done routine appears on day 0 as "never done"', async () => {
    await Routine.create({
      key: 'fresh',
      name: 'Fresh routine',
      category: 'cleaning',
      zone: 'whole-house',
      scheduling: { type: 'rolling', interval_days: 30, flex_days: 0 },
      estimate_minutes: 15,
      energy: 'low',
      active: true,
    });

    const r = await scheduleRange(NOW, 7);
    const day0 = findDay(r.days, NOW)!;
    const found = day0.routines_due.find((x) => x.routine_key === 'fresh');
    expect(found?.cadence_note).toBe('never done');
    expect(found?.source).toBe('rolling');
  });

  it('routine overdue at window start is bucketed on day 0 with overdue Nd', async () => {
    await Routine.create({
      key: 'late',
      name: 'Late routine',
      category: 'cleaning',
      zone: 'whole-house',
      scheduling: { type: 'rolling', interval_days: 7, flex_days: 0 },
      estimate_minutes: 10,
      energy: 'low',
      active: true,
      last_done: addDays(NOW, -10), // due 3 days before window start
    });

    const r = await scheduleRange(NOW, 7);
    const day0 = findDay(r.days, NOW)!;
    const found = day0.routines_due.find((x) => x.routine_key === 'late');
    expect(found?.cadence_note).toMatch(/^overdue 3d$/);
  });

  it('routine due exactly within window is bucketed on its due day', async () => {
    await Routine.create({
      key: 'mid',
      name: 'Mid routine',
      category: 'cleaning',
      zone: 'whole-house',
      scheduling: { type: 'rolling', interval_days: 7, flex_days: 0 },
      estimate_minutes: 10,
      energy: 'low',
      active: true,
      last_done: addDays(NOW, -4), // due in 3 days (within 7-day window)
    });

    const r = await scheduleRange(NOW, 7);
    const dueDay = findDay(r.days, addDays(NOW, 3))!;
    expect(dueDay.routines_due.find((x) => x.routine_key === 'mid')?.cadence_note).toBe('due');
  });

  it('routine due past window end is not surfaced', async () => {
    await Routine.create({
      key: 'far',
      name: 'Far routine',
      category: 'cleaning',
      zone: 'whole-house',
      scheduling: { type: 'rolling', interval_days: 30, flex_days: 0 },
      estimate_minutes: 10,
      energy: 'low',
      active: true,
      last_done: NOW, // next due in 30d, beyond a 7-day window
    });

    const r = await scheduleRange(NOW, 7);
    const flat = r.days.flatMap((d) => d.routines_due.map((x) => x.routine_key));
    expect(flat).not.toContain('far');
  });

  it("skip_if 'landscaper_this_week' suppresses routine on weeks with a landscaper trigger", async () => {
    await Routine.create({
      key: 'yard_pickup',
      name: 'Yard pickup',
      category: 'pet',
      zone: 'yard',
      scheduling: { type: 'rolling', interval_days: 30, flex_days: 5 },
      estimate_minutes: 25,
      energy: 'medium',
      skip_if: 'landscaper_this_week',
      active: true,
      last_done: addDays(NOW, -40),
    });
    await Trigger.create({
      type: 'landscaper',
      date: ymdOf(addDays(NOW, 2)),
      source: 'manual',
      ingested_at: NOW,
    });

    const r = await scheduleRange(NOW, 7);
    const flat = r.days.flatMap((d) => d.routines_due.map((x) => x.routine_key));
    expect(flat).not.toContain('yard_pickup');
  });
});

describe('scheduleRange — fixed routines', () => {
  it('weekly fixed routine appears on every matching day_of_week', async () => {
    await Routine.create({
      key: 'trash_prep',
      name: 'Bins to curb',
      category: 'trash',
      zone: 'whole-house',
      scheduling: { type: 'fixed', day_of_week: 'tue', biweekly: false },
      estimate_minutes: 20,
      energy: 'low',
      active: true,
    });

    const r = await scheduleRange(NOW, 14); // window covers two Tuesdays
    const tuesdays = r.days.filter((d) => dowOf(d) === 2);
    expect(tuesdays.length).toBeGreaterThanOrEqual(1);
    for (const tue of tuesdays) {
      expect(tue.routines_due.find((x) => x.routine_key === 'trash_prep')).toBeTruthy();
    }
  });

  it('biweekly fixed routine fires only on even-week tuesdays', async () => {
    await Routine.create({
      key: 'recycle_addon',
      name: 'Recycle bin',
      category: 'trash',
      zone: 'whole-house',
      scheduling: { type: 'fixed', day_of_week: 'tue', biweekly: true },
      estimate_minutes: 5,
      energy: 'low',
      active: true,
    });

    const r = await scheduleRange(NOW, 14);
    const recycles = r.days.filter((d) =>
      d.routines_due.some((x) => x.routine_key === 'recycle_addon'),
    );
    // Of two consecutive tuesdays, biweekly should hit exactly one.
    expect(recycles.length).toBe(1);
  });
});

describe('scheduleRange — event-driven routines', () => {
  it("airbnb_checkin_minus_1d fires the day before the trigger date", async () => {
    await Routine.create({
      key: 'airbnb_pre',
      name: 'Airbnb pre-checkin prep',
      category: 'airbnb',
      zone: 'whole-house',
      scheduling: { type: 'event_driven', trigger: 'airbnb_checkin_minus_1d' },
      estimate_minutes: 30,
      energy: 'medium',
      active: true,
    });
    const checkinDay = addDays(NOW, 4);
    await Trigger.create({
      type: 'airbnb_checkin',
      date: ymdOf(checkinDay),
      source: 'manual',
      ingested_at: NOW,
    });

    const r = await scheduleRange(NOW, 7);
    const fireDay = findDay(r.days, addDays(checkinDay, -1))!;
    expect(fireDay.routines_due.find((x) => x.routine_key === 'airbnb_pre')).toBeTruthy();
  });

  it('landscaper_date fires on the trigger date itself', async () => {
    await Routine.create({
      key: 'landscaper',
      name: 'Landscaper visit (FYI)',
      category: 'cleaning',
      zone: 'yard',
      scheduling: { type: 'event_driven', trigger: 'landscaper_date' },
      estimate_minutes: 0,
      energy: 'low',
      active: true,
    });
    const day = addDays(NOW, 2);
    await Trigger.create({
      type: 'landscaper',
      date: ymdOf(day),
      source: 'manual',
      ingested_at: NOW,
    });

    const r = await scheduleRange(NOW, 7);
    const target = findDay(r.days, day)!;
    expect(target.routines_due.find((x) => x.routine_key === 'landscaper')).toBeTruthy();
  });
});

describe('scheduleRange — meta', () => {
  it('clamps days to [1, 60] and chooses the right open_in_calendar_url view', async () => {
    const week = await scheduleRange(NOW, 7);
    expect(week.days.length).toBe(7);
    expect(week.open_in_calendar_url).toMatch(/\/r\/week\//);

    const month = await scheduleRange(NOW, 30);
    expect(month.days.length).toBe(30);
    expect(month.open_in_calendar_url).toMatch(/\/r\/month\//);

    const tooBig = await scheduleRange(NOW, 999);
    expect(tooBig.days.length).toBe(60);

    const tooSmall = await scheduleRange(NOW, 0);
    expect(tooSmall.days.length).toBe(1);
  });

  it('flags is_today on the matching day', async () => {
    const r = await scheduleRange(NOW, 7);
    const todayCount = r.days.filter((d) => d.is_today).length;
    expect(todayCount).toBe(1);
    expect(r.days[0]?.is_today).toBe(true);
  });

  it('returns calendar_connected=false in test mode (NODE_ENV guard)', async () => {
    const r = await scheduleRange(NOW, 7);
    expect(r.calendar_connected).toBe(false);
    for (const d of r.days) expect(d.events).toEqual([]);
  });

  it('exposes pending_adhoc_tasks', async () => {
    await AdHocTask.create({
      ts: NOW,
      zone: 'kitchen',
      name: 'Wipe counters',
      source: 'zone_assessment',
      severity: 'meh',
      estimate_minutes: 15,
      energy: 'low',
      status: 'open',
    });
    const r = await scheduleRange(NOW, 7);
    expect(r.pending_adhoc_tasks.length).toBe(1);
    expect(r.pending_adhoc_tasks[0]?.name).toBe('Wipe counters');
  });
});
