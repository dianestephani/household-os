import { TodayPlan } from '../db/models/TodayPlan.js';
import { upsertEvent } from '../utils/google-calendar.js';

function formatChecklist(plan: InstanceType<typeof TodayPlan>): string {
  const items = (plan.items ?? []).map((it) => {
    const box = it.status === 'done' ? '✅' : '☐';
    return `${box} ${it.name} (${it.estimate_minutes} min)`;
  });
  if (plan.swap_pool && plan.swap_pool.length) {
    items.push('', '— Swap pool —');
    for (const it of plan.swap_pool) {
      items.push(`☐ ${it.name} (${it.estimate_minutes} min)`);
    }
  }
  const used = (plan.items ?? []).reduce(
    (acc, it) => acc + (it.estimate_minutes ?? 0),
    0,
  );
  return [
    `Energy: ${plan.current_energy} · Budget: ${plan.budget_minutes} min · Planned: ${used} min`,
    `Day type: ${plan.day_type}`,
    '',
    ...items,
  ].join('\n');
}

export async function syncToCalendar(
  plan: InstanceType<typeof TodayPlan>,
): Promise<void> {
  const description = formatChecklist(plan);
  const eventBody = {
    summary: `Household: Today (${plan.date})`,
    description,
    start: { date: plan.date },
    end: { date: plan.date },
  };

  const newId = await upsertEvent(
    eventBody,
    plan.publisher?.calendar_event_id ?? null,
  );
  if (newId) {
    plan.publisher = plan.publisher ?? {};
    plan.publisher.calendar_event_id = newId;
  }
}
