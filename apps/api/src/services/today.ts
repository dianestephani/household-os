import { Routine } from '../db/models/Routine.js';
import { TodayPlan } from '../db/models/TodayPlan.js';
import { DeferralEvent } from '../db/models/DeferralEvent.js';
import { ymd } from '../utils/dates.js';
import { generateTodayPlan } from '../cron/morning-gen.js';
import { publish } from '../publisher/index.js';
import {
  isAdHocKey,
  idFromAdHocKey,
  markAdHocTaskDone,
} from './zones.js';
import { logActivity } from './activity.js';
import type {
  DeferReasonCode,
  EnergyLevel,
} from '@household-os/shared/types';

export async function ensureTodayPlan() {
  const dateStr = ymd(new Date());
  let plan = await TodayPlan.findOne({ date: dateStr });
  if (!plan) {
    const { planId } = await generateTodayPlan(new Date());
    plan = await TodayPlan.findById(planId);
  }
  return plan;
}

export async function getToday() {
  return ensureTodayPlan();
}

export async function regenerateToday() {
  const { planId } = await generateTodayPlan(new Date(), { force: true });
  await logActivity('plan_regenerated', "Regenerated today's plan");
  publish(planId);
  return TodayPlan.findById(planId);
}

export async function swapTask(
  itemKey: string,
  replacementKey?: string,
  reason: DeferReasonCode = 'manual_swap',
  notes?: string,
) {
  const plan = await ensureTodayPlan();
  if (!plan) return null;

  const idx = plan.items.findIndex((it) => it.routine_key === itemKey);
  if (idx < 0) return plan;
  const removed = plan.items[idx]!;

  plan.swap_pool.push({
    routine_key: removed.routine_key,
    name: removed.name,
    estimate_minutes: removed.estimate_minutes ?? 0,
    energy: (removed.energy as EnergyLevel) ?? 'low',
    deferred_at: new Date(),
    reason,
  });
  plan.items.splice(idx, 1);

  await DeferralEvent.create({
    ts: new Date(),
    date: plan.date,
    routine_key: removed.routine_key,
    routine_name: removed.name,
    reason,
    notes,
    source: 'user',
  });

  let pulledInName: string | null = null;
  if (replacementKey) {
    const poolIdx = plan.swap_pool.findIndex(
      (p) => p.routine_key === replacementKey,
    );
    if (poolIdx >= 0) {
      const fromPool = plan.swap_pool[poolIdx]!;
      plan.items.push({
        routine_key: fromPool.routine_key,
        name: fromPool.name,
        estimate_minutes: fromPool.estimate_minutes,
        energy: fromPool.energy,
        status: 'pending',
        order: plan.items.length,
      });
      plan.swap_pool.splice(poolIdx, 1);
      pulledInName = fromPool.name;
    } else {
      const r = await Routine.findOne({ key: replacementKey });
      if (r) {
        plan.items.push({
          routine_key: r.key,
          name: r.name ?? r.key,
          estimate_minutes: r.estimate_minutes ?? 0,
          energy: (r.energy as EnergyLevel) ?? 'low',
          status: 'pending',
          order: plan.items.length,
        });
        pulledInName = r.name ?? r.key;
      }
    }
  }

  await plan.save();

  if (pulledInName) {
    await logActivity(
      'task_swapped',
      `Swapped "${removed.name}" out for "${pulledInName}"`,
      { metadata: { from: removed.routine_key, to: replacementKey, reason } },
    );
  } else {
    await logActivity('task_deferred', `Deferred "${removed.name}"`, {
      metadata: { routine_key: removed.routine_key, reason },
    });
  }

  publish(plan.id);
  return plan;
}

export async function markDone(itemKey: string) {
  const plan = await ensureTodayPlan();
  if (!plan) return null;

  const item = plan.items.find((it) => it.routine_key === itemKey);
  if (!item) return plan;
  item.status = 'done';
  item.completed_at = new Date();
  await plan.save();

  if (isAdHocKey(itemKey)) {
    await markAdHocTaskDone(idFromAdHocKey(itemKey));
  } else {
    await Routine.updateOne(
      { key: itemKey },
      { $set: { last_done: new Date() } },
    );
  }

  await logActivity('task_done', `Marked "${item.name}" done`, {
    metadata: { routine_key: itemKey, estimate_minutes: item.estimate_minutes },
  });

  publish(plan.id);
  return plan;
}

export async function pullFromPool(itemKey: string) {
  const plan = await ensureTodayPlan();
  if (!plan) return null;

  const idx = plan.swap_pool.findIndex((p) => p.routine_key === itemKey);
  if (idx < 0) return plan;
  const item = plan.swap_pool[idx]!;
  plan.items.push({
    routine_key: item.routine_key,
    name: item.name,
    estimate_minutes: item.estimate_minutes,
    energy: item.energy,
    status: 'pending',
    order: plan.items.length,
  });
  plan.swap_pool.splice(idx, 1);

  await plan.save();
  await logActivity('task_pulled', `Pulled "${item.name}" back into today`, {
    metadata: { routine_key: item.routine_key },
  });
  publish(plan.id);
  return plan;
}
