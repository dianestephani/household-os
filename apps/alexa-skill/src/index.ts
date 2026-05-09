import {
  SkillBuilders,
  type RequestHandler,
  type ErrorHandler,
  getSlotValue,
  getIntentName,
  getRequestType,
} from 'ask-sdk-core';
import { apiClient, fuzzyMatch } from './client.js';

const LaunchRequestHandler: RequestHandler = {
  canHandle(input) {
    return getRequestType(input.requestEnvelope) === 'LaunchRequest';
  },
  handle(input) {
    return input.responseBuilder
      .speak('Household Ops here. Want today\'s brief?')
      .reprompt('Say "what\'s on today" or "I\'m low energy".')
      .getResponse();
  },
};

const TodayBriefHandler: RequestHandler = {
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
              .join(', ')}${pending.length > 4 ? `, and ${pending.length - 4} more` : ''}.`;
      return input.responseBuilder.speak(speech).getResponse();
    } catch (err) {
      return input.responseBuilder
        .speak(`Couldn't reach the API: ${(err as Error).message}`)
        .getResponse();
    }
  },
};

const SwapTaskHandler: RequestHandler = {
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
    return input.responseBuilder.speak(`Deferred ${match.name}.`).getResponse();
  },
};

const MarkDoneHandler: RequestHandler = {
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
    return input.responseBuilder.speak(`Marked ${match.name} done.`).getResponse();
  },
};

const UpdateEnergyHandler: RequestHandler = {
  canHandle(input) {
    return (
      getRequestType(input.requestEnvelope) === 'IntentRequest' &&
      getIntentName(input.requestEnvelope) === 'UpdateEnergyIntent'
    );
  },
  async handle(input) {
    const level = getSlotValue(input.requestEnvelope, 'Level');
    if (!level || !['low', 'medium', 'high'].includes(level)) {
      return input.responseBuilder
        .speak('Energy needs to be low, medium, or high.')
        .getResponse();
    }
    const sug = await apiClient.setEnergy(level);
    const out = sug.suggested_swaps_out.length;
    const inn = sug.suggested_swaps_in.length;
    if (out === 0 && inn === 0) {
      return input.responseBuilder
        .speak(`Got it. Energy is ${level}. No changes needed.`)
        .getResponse();
    }
    const parts: string[] = [];
    if (out > 0) parts.push(`I'd defer ${sug.suggested_swaps_out.map((s) => s.name).join(', ')}`);
    if (inn > 0) parts.push(`pull in ${sug.suggested_swaps_in.map((s) => s.name).join(', ')}`);
    return input.responseBuilder
      .speak(`Energy ${level}. ${parts.join('; and ')}. Want me to apply?`)
      .reprompt('Say yes to apply, or skip.')
      .getResponse();
  },
};

const AskHouseholdHandler: RequestHandler = {
  canHandle(input) {
    return (
      getRequestType(input.requestEnvelope) === 'IntentRequest' &&
      getIntentName(input.requestEnvelope) === 'AskHouseholdIntent'
    );
  },
  async handle(input) {
    const query = getSlotValue(input.requestEnvelope, 'Query') ?? '';
    if (!query) {
      return input.responseBuilder.speak('What did you want to ask?').getResponse();
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

const HelpHandler: RequestHandler = {
  canHandle(input) {
    return (
      getRequestType(input.requestEnvelope) === 'IntentRequest' &&
      getIntentName(input.requestEnvelope) === 'AMAZON.HelpIntent'
    );
  },
  handle(input) {
    return input.responseBuilder
      .speak('Try: "what\'s on today", "mark trash done", or "I\'m low energy".')
      .reprompt('What do you want to do?')
      .getResponse();
  },
};

const CancelStopHandler: RequestHandler = {
  canHandle(input) {
    const name = getIntentName(input.requestEnvelope);
    return (
      getRequestType(input.requestEnvelope) === 'IntentRequest' &&
      (name === 'AMAZON.CancelIntent' || name === 'AMAZON.StopIntent')
    );
  },
  handle(input) {
    return input.responseBuilder.speak('Bye.').getResponse();
  },
};

const FallbackHandler: RequestHandler = {
  canHandle(input) {
    return (
      getRequestType(input.requestEnvelope) === 'IntentRequest' &&
      getIntentName(input.requestEnvelope) === 'AMAZON.FallbackIntent'
    );
  },
  handle(input) {
    return input.responseBuilder
      .speak("Didn't catch that. Try: \"what's on today\".")
      .reprompt('What do you want to do?')
      .getResponse();
  },
};

const SessionEndedHandler: RequestHandler = {
  canHandle(input) {
    return getRequestType(input.requestEnvelope) === 'SessionEndedRequest';
  },
  handle(input) {
    return input.responseBuilder.getResponse();
  },
};

const ErrorHandlerImpl: ErrorHandler = {
  canHandle() {
    return true;
  },
  handle(input, error) {
    console.error('[alexa] error', error);
    return input.responseBuilder
      .speak("Something went wrong. Try again in a moment.")
      .getResponse();
  },
};

export const handler = SkillBuilders.custom()
  .addRequestHandlers(
    LaunchRequestHandler,
    TodayBriefHandler,
    SwapTaskHandler,
    MarkDoneHandler,
    UpdateEnergyHandler,
    AskHouseholdHandler,
    HelpHandler,
    CancelStopHandler,
    FallbackHandler,
    SessionEndedHandler,
  )
  .addErrorHandlers(ErrorHandlerImpl)
  .lambda();
