import { pushProactiveEvent } from '../utils/alexa-lwa.js';
import type { PatternInterruptContext } from '@household-os/shared/types';

export interface PushableCheckIn {
  _id?: unknown;
  type: string;
  context?: {
    kind?: string | null;
    routine_name?: string | null;
    count?: number | null;
  } | null;
}

/**
 * Pure body-template builder. Extracted so it's unit-testable without going
 * through the LWA-push side effect. Returns null when the check-in type
 * isn't one of the two we surface as proactive cards (everything else stays
 * dashboard-only by design).
 */
export function buildCheckInCardBody(checkin: PushableCheckIn): string | null {
  if (checkin.type === 'morning_intent') {
    return "Morning check-in pending — say 'answer my morning check-in' to Home Ops, or open the dashboard.";
  }
  if (checkin.type === 'pattern_interrupt') {
    const ctx = checkin.context as PatternInterruptContext | undefined;
    if (ctx?.kind === 'frequent_deferral' && ctx.routine_name) {
      return `${ctx.routine_name} has been deferred ${ctx.count ?? 0} times. Decide: push through, swap, or adjust the cadence?`;
    }
    if (ctx?.kind === 'missed_workouts') {
      return `You've skipped ${ctx.count ?? 0} workouts in a row. What's the plan for today's slot?`;
    }
    return 'Pattern interrupt: open Home Ops to address it.';
  }
  return null;
}

/**
 * Push an Alexa app card for a time-sensitive check-in. Currently only
 * morning_intent and pattern_interrupt fire — evening retro / weekly review
 * stay dashboard-only by design.
 *
 * Soft-fails if `ALEXA_SKILL_ID` or LWA creds are missing.
 */
export async function pushCheckInCard(checkin: PushableCheckIn): Promise<void> {
  if (!process.env.ALEXA_SKILL_ID) return;

  const body = buildCheckInCardBody(checkin);
  if (body === null) return; // out of scope for proactive push

  const id = String(checkin._id ?? '');
  const expiry = new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString();

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
