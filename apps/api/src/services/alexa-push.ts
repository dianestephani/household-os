import { pushProactiveEvent } from '../utils/alexa-lwa.js';
import type { PatternInterruptContext } from '@household-os/shared/types';

/**
 * Push an Alexa app card for a time-sensitive check-in. Currently only
 * morning_intent and pattern_interrupt fire — evening retro / weekly review
 * stay dashboard-only by design.
 *
 * Type is intentionally loose (`string`) because Mongoose's InferSchemaType
 * returns `string` for enum-like fields; the runtime guard below handles it.
 *
 * Soft-fails if `ALEXA_SKILL_ID` or LWA creds are missing.
 */
export async function pushCheckInCard(checkin: {
  _id?: unknown;
  type: string;
  context?: {
    kind?: string | null;
    routine_name?: string | null;
    count?: number | null;
  } | null;
}): Promise<void> {
  if (!process.env.ALEXA_SKILL_ID) return;
  if (
    checkin.type !== 'morning_intent' &&
    checkin.type !== 'pattern_interrupt'
  ) {
    return; // out of scope for proactive push
  }

  const id = String(checkin._id ?? '');
  const expiry = new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString();

  let body = '';
  if (checkin.type === 'morning_intent') {
    body = "Morning check-in pending — say 'answer my morning check-in' to Home Ops, or open the dashboard.";
  } else if (checkin.type === 'pattern_interrupt') {
    const ctx = checkin.context as PatternInterruptContext | undefined;
    if (ctx?.kind === 'frequent_deferral' && ctx.routine_name) {
      body = `${ctx.routine_name} has been deferred ${ctx.count ?? 0} times. Decide: push through, swap, or adjust the cadence?`;
    } else if (ctx?.kind === 'missed_workouts') {
      body = `You've skipped ${ctx.count ?? 0} workouts in a row. What's the plan for today's slot?`;
    } else {
      body = 'Pattern interrupt: open Home Ops to address it.';
    }
  }

  await pushProactiveEvent({
    timestamp: new Date().toISOString(),
    referenceId: `checkin-${id}-${Date.now()}`,
    expiryTime: expiry,
    event: {
      name: 'AMAZON.MessageAlert.Activated',
      payload: {
        state: { status: 'UNREAD', freshness: 'NEW' },
        messageGroup: {
          creator: { name: 'Household Ops' },
          count: 1,
        },
      },
    },
    localizedAttributes: [{ locale: 'en-US', bodyTemplate: body }],
    relevantAudience: { type: 'Multicast', payload: {} },
  });
}
