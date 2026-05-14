import {
  type RequestHandler,
  type ErrorHandler,
  getIntentName,
  getRequestType,
} from 'ask-sdk-core';

export const LaunchRequestHandler: RequestHandler = {
  canHandle(input) {
    return getRequestType(input.requestEnvelope) === 'LaunchRequest';
  },
  handle(input) {
    return input.responseBuilder
      .speak("Household Ops here. Ask what's left on your calendar today.")
      .reprompt('Try "what\'s left for the day".')
      .getResponse();
  },
};

/**
 * §50 Phase F — Help text trimmed to the surviving intent. The full
 * household-Ops voice flow (mark done, swap, energy, mood, check-ins, etc.)
 * retired with the underlying endpoints. Everything else lives in the
 * dashboard now.
 */
export const HelpHandler: RequestHandler = {
  canHandle(input) {
    return (
      getRequestType(input.requestEnvelope) === 'IntentRequest' &&
      getIntentName(input.requestEnvelope) === 'AMAZON.HelpIntent'
    );
  },
  handle(input) {
    return input.responseBuilder
      .speak(
        'You can ask "what\'s left for the day" to hear your remaining Calendar events. Everything else lives on the dashboard now.',
      )
      .reprompt('Try "what\'s left for the day".')
      .getResponse();
  },
};

export const CancelStopHandler: RequestHandler = {
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

export const FallbackHandler: RequestHandler = {
  canHandle(input) {
    return (
      getRequestType(input.requestEnvelope) === 'IntentRequest' &&
      getIntentName(input.requestEnvelope) === 'AMAZON.FallbackIntent'
    );
  },
  handle(input) {
    return input.responseBuilder
      .speak("Didn't catch that. Say \"help\" for what I can do.")
      .reprompt('What do you want to do?')
      .getResponse();
  },
};

export const SessionEndedHandler: RequestHandler = {
  canHandle(input) {
    return getRequestType(input.requestEnvelope) === 'SessionEndedRequest';
  },
  handle(input) {
    return input.responseBuilder.getResponse();
  },
};

export const ErrorHandlerImpl: ErrorHandler = {
  canHandle() {
    return true;
  },
  handle(input, error) {
    console.error('[alexa] error', error);
    return input.responseBuilder
      .speak('Something went wrong. Try again in a moment.')
      .getResponse();
  },
};
