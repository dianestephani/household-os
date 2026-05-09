import { TodayPlan } from '../db/models/TodayPlan.js';
import { pushProactiveEvent } from '../utils/alexa-lwa.js';

function formatBody(plan: InstanceType<typeof TodayPlan>): string {
  const lines = (plan.items ?? []).map((it) => {
    const box = it.status === 'done' ? '✅' : '☐';
    return `${box} ${it.name} (${it.estimate_minutes} min)`;
  });
  return lines.join('\n');
}

export async function syncToAlexa(
  plan: InstanceType<typeof TodayPlan>,
): Promise<void> {
  if (!process.env.ALEXA_SKILL_ID) {
    console.log('[alexa] no ALEXA_SKILL_ID — skipping push');
    return;
  }

  const expiry = new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString();
  const referenceId = `household-${plan.date}-${Date.now()}`;
  const ok = await pushProactiveEvent({
    timestamp: new Date().toISOString(),
    referenceId,
    expiryTime: expiry,
    event: {
      name: 'AMAZON.MessageAlert.Activated',
      payload: {
        state: { status: 'UNREAD', freshness: 'NEW' },
        messageGroup: {
          creator: { name: 'Household Ops' },
          count: (plan.items ?? []).filter((i) => i.status !== 'done').length,
        },
      },
    },
    localizedAttributes: [
      {
        locale: 'en-US',
        bodyTemplate: formatBody(plan),
      },
    ],
    relevantAudience: { type: 'Multicast', payload: {} },
  });

  if (ok) {
    plan.publisher = plan.publisher ?? {};
    plan.publisher.alexa_notif_id = referenceId;
  }
}
