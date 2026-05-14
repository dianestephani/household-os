import {
  type RequestHandler,
  getIntentName,
  getRequestType,
} from 'ask-sdk-core';
import { apiClient } from '../client.js';

/**
 * §50 Phase F — WhatsLeftIntent retooled against Google Calendar events.
 *
 * Pre-§50: "what am I still missing" → `GET /api/today/whats-left`, which
 * read incomplete items off the TodayPlan. TodayPlan retired in Phase C, so
 * we now read today's Calendar events directly. The interpretation shifts
 * slightly — "what's left" used to be "uncompleted routines on today's
 * plan," it's now "Calendar events later today that haven't started yet."
 *
 * If no Calendar events are still upcoming, we say so. If Calendar isn't
 * connected, we admit that rather than hallucinate a plan.
 */
export const WhatsLeftHandler: RequestHandler = {
  canHandle(input) {
    return (
      getRequestType(input.requestEnvelope) === 'IntentRequest' &&
      getIntentName(input.requestEnvelope) === 'WhatsLeftIntent'
    );
  },
  async handle(input) {
    try {
      const data = await apiClient.calendarToday();
      if (!data.connected) {
        return input.responseBuilder
          .speak(
            "I can't see your calendar right now. Reconnect Google Calendar to use this.",
          )
          .getResponse();
      }
      const upcoming = filterUpcoming(data.events, new Date());
      if (upcoming.length === 0) {
        return input.responseBuilder
          .speak("You don't have anything scheduled for the rest of today.")
          .getResponse();
      }
      const top = upcoming.slice(0, 3).map((e) => e.summary);
      const list =
        top.length > 1
          ? `${top.slice(0, -1).join(', ')}, and ${top[top.length - 1]!}`
          : top[0]!;
      const tail =
        upcoming.length > 3 ? `, and ${upcoming.length - 3} more` : '';
      const speech = `You have ${upcoming.length} event${
        upcoming.length === 1 ? '' : 's'
      } left today: ${list}${tail}.`;
      return input.responseBuilder.speak(speech).getResponse();
    } catch (err) {
      return input.responseBuilder
        .speak(`Couldn't reach the API: ${(err as Error).message}`)
        .getResponse();
    }
  },
};

interface MinimalEvent {
  id: string;
  summary: string;
  start: string;
  is_all_day: boolean;
}

/**
 * Filter out events that have already started OR that lack a start time.
 * All-day events count as "still happening today" until midnight, so they
 * stay in the list — Diane probably wants the reminder.
 */
export function filterUpcoming(
  events: MinimalEvent[],
  now: Date,
): MinimalEvent[] {
  return events.filter((e) => {
    if (!e.start) return false;
    if (e.is_all_day) return true;
    const start = new Date(e.start);
    if (Number.isNaN(start.getTime())) return false;
    return start.getTime() > now.getTime();
  });
}
