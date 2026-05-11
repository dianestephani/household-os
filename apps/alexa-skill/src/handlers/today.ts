import {
  type RequestHandler,
  getSlotValue,
  getIntentName,
  getRequestType,
} from 'ask-sdk-core';
import { apiClient, fuzzyMatch } from '../client.js';

export const TodayBriefHandler: RequestHandler = {
  canHandle(input) {
    return (
      getRequestType(input.requestEnvelope) === 'IntentRequest' &&
      getIntentName(input.requestEnvelope) === 'TodayBriefIntent'
    );
  },
  async handle(input) {
    try {
      const plan = await apiClient.getToday();
      const pending = plan.items.filter((it) => it.status !== 'done');
      const speech =
        pending.length === 0
          ? "Today's plan is empty or complete. Nice."
          : `Today: ${pending
              .slice(0, 4)
              .map((it) => it.name)
              .join(', ')}${
              pending.length > 4 ? `, and ${pending.length - 4} more` : ''
            }.`;
      return input.responseBuilder.speak(speech).getResponse();
    } catch (err) {
      return input.responseBuilder
        .speak(`Couldn't reach the API: ${(err as Error).message}`)
        .getResponse();
    }
  },
};

export const SwapTaskHandler: RequestHandler = {
  canHandle(input) {
    return (
      getRequestType(input.requestEnvelope) === 'IntentRequest' &&
      getIntentName(input.requestEnvelope) === 'SwapTaskIntent'
    );
  },
  async handle(input) {
    const phrase = getSlotValue(input.requestEnvelope, 'Task') ?? '';
    const plan = await apiClient.getToday();
    const match = fuzzyMatch(plan.items, phrase);
    if (!match) {
      return input.responseBuilder
        .speak(`I don't see "${phrase}" on today.`)
        .getResponse();
    }
    await apiClient.swap(match.routine_key);
    return input.responseBuilder
      .speak(`Deferred ${match.name}.`)
      .getResponse();
  },
};

export const MarkDoneHandler: RequestHandler = {
  canHandle(input) {
    return (
      getRequestType(input.requestEnvelope) === 'IntentRequest' &&
      getIntentName(input.requestEnvelope) === 'MarkDoneIntent'
    );
  },
  async handle(input) {
    const phrase = getSlotValue(input.requestEnvelope, 'Task') ?? '';
    const plan = await apiClient.getToday();
    const match = fuzzyMatch(plan.items, phrase);
    if (!match) {
      return input.responseBuilder
        .speak(`I don't see "${phrase}" on today.`)
        .getResponse();
    }
    await apiClient.markDone(match.routine_key);
    return input.responseBuilder
      .speak(`Marked ${match.name} done.`)
      .getResponse();
  },
};

/**
 * "Alexa, ask Home Ops what's left" / "what am I still missing for the day"
 * → reads the open items on Today and reports name + total minutes.
 * §47 Phase 6c.
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
      const { items, total_minutes } = await apiClient.whatsLeft();
      if (items.length === 0) {
        return input.responseBuilder
          .speak("You're done for today.")
          .getResponse();
      }
      const top = items.slice(0, 3).map((i) => i.name);
      const tail =
        items.length > 3 ? `, and ${items.length - 3} more` : '';
      // Oxford-style join: "a, b, and c"
      const list =
        top.length > 1
          ? `${top.slice(0, -1).join(', ')}, and ${top[top.length - 1]!}`
          : top[0]!;
      const speech = `You have ${items.length} item${
        items.length === 1 ? '' : 's'
      } left: ${list}${tail}. About ${total_minutes} minute${
        total_minutes === 1 ? '' : 's'
      } total.`;
      return input.responseBuilder.speak(speech).getResponse();
    } catch (err) {
      return input.responseBuilder
        .speak(`Couldn't reach the API: ${(err as Error).message}`)
        .getResponse();
    }
  },
};

export const PullFromPoolHandler: RequestHandler = {
  canHandle(input) {
    return (
      getRequestType(input.requestEnvelope) === 'IntentRequest' &&
      getIntentName(input.requestEnvelope) === 'PullFromPoolIntent'
    );
  },
  async handle(input) {
    const phrase = getSlotValue(input.requestEnvelope, 'Task') ?? '';
    const plan = await apiClient.getToday();
    const match = fuzzyMatch(plan.swap_pool, phrase);
    if (!match) {
      return input.responseBuilder
        .speak(`I don't see "${phrase}" in the swap pool.`)
        .getResponse();
    }
    await apiClient.pullFromPool(match.routine_key);
    return input.responseBuilder
      .speak(`Pulled ${match.name} back into today.`)
      .getResponse();
  },
};
