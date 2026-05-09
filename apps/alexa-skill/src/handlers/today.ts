import {
  type RequestHandler,
  getSlotValue,
  getIntentName,
  getRequestType,
} from 'ask-sdk-core';
import { apiClient, fuzzyMatch, type DeferReason } from '../client.js';

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
    const reason =
      (getSlotValue(input.requestEnvelope, 'Reason') as DeferReason | undefined) ??
      undefined;
    const plan = await apiClient.getToday();
    const match = fuzzyMatch(plan.items, phrase);
    if (!match) {
      return input.responseBuilder
        .speak(`I don't see "${phrase}" on today.`)
        .getResponse();
    }
    await apiClient.swap(match.routine_key, reason);
    return input.responseBuilder
      .speak(`Deferred ${match.name}${reason ? `: ${reason.replace(/_/g, ' ')}` : ''}.`)
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
