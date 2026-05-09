import {
  type RequestHandler,
  getSlotValue,
  getIntentName,
  getRequestType,
} from 'ask-sdk-core';
import { apiClient } from '../client.js';

export const WhatDidIDoHandler: RequestHandler = {
  canHandle(input) {
    return (
      getRequestType(input.requestEnvelope) === 'IntentRequest' &&
      getIntentName(input.requestEnvelope) === 'WhatDidIDoIntent'
    );
  },
  async handle(input) {
    const days = Number(getSlotValue(input.requestEnvelope, 'Days') ?? 1);
    const activity = await apiClient.recentActivity(days);
    const userActions = activity
      .filter((a) => a.actor === 'user')
      .filter((a) =>
        ['task_done', 'task_deferred', 'task_swapped', 'workout_logged']
          .includes(a.kind),
      );
    if (userActions.length === 0) {
      return input.responseBuilder
        .speak(
          days === 1
            ? "Nothing notable today yet."
            : `Nothing notable in the last ${days} days.`,
        )
        .getResponse();
    }
    const summary = userActions.slice(0, 5).map((a) => a.summary).join('. ');
    return input.responseBuilder
      .speak(
        `${userActions.length} action${
          userActions.length === 1 ? '' : 's'
        } in the last ${days} day${days === 1 ? '' : 's'}. Recent: ${summary}.`,
      )
      .getResponse();
  },
};

export const PatternsHandler: RequestHandler = {
  canHandle(input) {
    return (
      getRequestType(input.requestEnvelope) === 'IntentRequest' &&
      getIntentName(input.requestEnvelope) === 'PatternsIntent'
    );
  },
  async handle(input) {
    const [deferrals, workouts] = await Promise.all([
      apiClient.frequentDeferrals(14, 2),
      apiClient.workoutSummary(14),
    ]);
    const parts: string[] = [];
    if (deferrals.length > 0) {
      const top = deferrals.slice(0, 2);
      parts.push(
        `Repeat deferrals: ${top
          .map((d) => `${d.routine_name} ${d.count} times`)
          .join(', ')}.`,
      );
    } else {
      parts.push('No repeat deferrals.');
    }
    parts.push(
      `Workouts: ${workouts.done} done, ${workouts.skipped} skipped, ${workouts.partial} partial in the last 14 days.`,
    );
    return input.responseBuilder.speak(parts.join(' ')).getResponse();
  },
};

export const AskHouseholdHandler: RequestHandler = {
  canHandle(input) {
    return (
      getRequestType(input.requestEnvelope) === 'IntentRequest' &&
      getIntentName(input.requestEnvelope) === 'AskHouseholdIntent'
    );
  },
  async handle(input) {
    const query = getSlotValue(input.requestEnvelope, 'Query') ?? '';
    if (!query) {
      return input.responseBuilder
        .speak('What did you want to ask?')
        .getResponse();
    }
    try {
      const res = await apiClient.chat('household', query);
      return input.responseBuilder.speak(res.reply || 'Done.').getResponse();
    } catch (err) {
      return input.responseBuilder
        .speak(`Chat failed: ${(err as Error).message}`)
        .getResponse();
    }
  },
};
