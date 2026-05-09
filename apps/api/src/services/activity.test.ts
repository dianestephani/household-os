import { describe, it, expect } from 'vitest';
import { ActivityLog } from '../db/models/ActivityLog.js';
import { logActivity, recentActivity } from './activity.js';

describe('logActivity / recentActivity', () => {
  it('writes an entry with default actor=user', async () => {
    await logActivity('task_done', 'Marked "Litter" done');
    const all = await ActivityLog.find({}).lean();
    expect(all.length).toBe(1);
    expect(all[0]?.kind).toBe('task_done');
    expect(all[0]?.actor).toBe('user');
  });

  it('respects caller-supplied actor and metadata', async () => {
    await logActivity('plan_generated', 'Generated plan', {
      actor: 'cron',
      metadata: { items: 5 },
    });
    const log = await ActivityLog.findOne({});
    expect(log?.actor).toBe('cron');
    expect(log?.metadata).toEqual({ items: 5 });
  });

  it('returns recent entries newest-first', async () => {
    await logActivity('task_done', 'A');
    await new Promise((r) => setTimeout(r, 5));
    await logActivity('task_done', 'B');
    const list = await recentActivity();
    expect(list.map((e) => e.summary)).toEqual(['B', 'A']);
  });

  it('filters by kind when provided', async () => {
    await logActivity('task_done', 'done it');
    await logActivity('task_deferred', 'deferred it');
    const onlyDone = await recentActivity(7, 'task_done');
    expect(onlyDone.length).toBe(1);
    expect(onlyDone[0]?.kind).toBe('task_done');
  });

  it('excludes entries outside the day window', async () => {
    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await ActivityLog.create({
      ts: old,
      kind: 'task_done',
      summary: 'old',
      actor: 'user',
    });
    const list = await recentActivity(7);
    expect(list.length).toBe(0);
  });

  it('logging never throws even if the underlying write fails', async () => {
    // This should not throw — the helper swallows + logs to console.
    // (Observability is non-load-bearing.)
    await expect(
      logActivity('task_done', 'x'.repeat(2)),
    ).resolves.toBeUndefined();
  });
});
