import {
  type RequestHandler,
  getSlotValue,
  getIntentName,
  getRequestType,
} from 'ask-sdk-core';
import { apiClient, type EnergyLevel, type MoodLevel } from '../client.js';

export const ListPendingCheckInsHandler: RequestHandler = {
  canHandle(input) {
    return (
      getRequestType(input.requestEnvelope) === 'IntentRequest' &&
      getIntentName(input.requestEnvelope) === 'ListPendingCheckInsIntent'
    );
  },
  async handle(input) {
    const pending = await apiClient.pendingCheckIns();
    if (pending.length === 0) {
      return input.responseBuilder
        .speak("Nothing pending — you're caught up.")
        .getResponse();
    }
    const types = pending.map((c) =>
      c.type.replace(/_/g, ' ').replace('intent', 'check-in'),
    );
    return input.responseBuilder
      .speak(
        `You have ${pending.length} pending: ${types.join(', ')}. Say "answer my morning check-in" to answer one out loud.`,
      )
      .getResponse();
  },
};

/**
 * Multi-slot dialog flow for the morning intent check-in. Alexa drives slot
 * collection (one_thing → energy → mood) using prompts from the interaction
 * model. When dialog is complete, we submit the answers via the API.
 */
export const AnswerMorningCheckInHandler: RequestHandler = {
  canHandle(input) {
    return (
      getRequestType(input.requestEnvelope) === 'IntentRequest' &&
      getIntentName(input.requestEnvelope) === 'AnswerMorningCheckInIntent'
    );
  },
  async handle(input) {
    const dialogState = input.requestEnvelope.request.type === 'IntentRequest'
      ? input.requestEnvelope.request.dialogState
      : undefined;

    if (dialogState !== 'COMPLETED') {
      // Confirm there's actually a pending morning check-in before prompting.
      const pending = await apiClient.pendingCheckIns();
      const morning = pending.find((c) => c.type === 'morning_intent');
      if (!morning) {
        return input.responseBuilder
          .speak(
            "No morning check-in pending. Either you already answered it or it hasn't been generated yet.",
          )
          .getResponse();
      }
      return input.responseBuilder.addDelegateDirective().getResponse();
    }

    const oneThing = getSlotValue(input.requestEnvelope, 'OneThing');
    const energy = getSlotValue(input.requestEnvelope, 'Energy') as
      | EnergyLevel
      | undefined;
    const mood = getSlotValue(input.requestEnvelope, 'Mood') as
      | MoodLevel
      | undefined;

    const pending = await apiClient.pendingCheckIns();
    const morning = pending.find((c) => c.type === 'morning_intent');
    if (!morning) {
      return input.responseBuilder
        .speak('Looks like the morning check-in was already answered.')
        .getResponse();
    }

    const answers: Record<string, string> = {};
    if (oneThing) answers.one_thing_today = oneThing;
    if (energy) answers.energy = energy;
    if (mood) answers.mood = mood;
    await apiClient.answerCheckIn(morning._id, answers);

    return input.responseBuilder
      .speak(`Morning check-in logged. ${oneThing ? `Today: ${oneThing}.` : ''}`)
      .getResponse();
  },
};
