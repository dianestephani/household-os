import debounce from 'lodash.debounce';
import { TodayPlan } from '../db/models/TodayPlan.js';
import { syncToCalendar } from './calendar.js';
import { syncToAlexa } from './alexa.js';

async function flushPlan(planId: string): Promise<void> {
  const plan = await TodayPlan.findById(planId);
  if (!plan) return;
  await Promise.all([syncToCalendar(plan), syncToAlexa(plan)]);
  plan.publisher = plan.publisher ?? {};
  plan.publisher.last_synced_at = new Date();
  await plan.save();
}

const debounced = debounce(flushPlan, 5000);

/**
 * Schedule a debounced publish for a TodayPlan. Multiple writes within 5s
 * coalesce to a single fan-out to Calendar + Alexa.
 */
export function publish(planId: string): void {
  void debounced(planId);
}

/**
 * Force an immediate publish (used when we want to feel synchronous, e.g. from
 * a `regenerate` request).
 */
export async function publishNow(planId: string): Promise<void> {
  await flushPlan(planId);
}
