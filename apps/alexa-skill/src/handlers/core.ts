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
      .speak("Household Ops here. What's up?")
      .reprompt('Try "what\'s on today" or "I\'m low energy".')
      .getResponse();
  },
};

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
        'You can say things like: "what\'s on today", "mark trash done", "I\'m low energy", "the kitchen is rough", "I worked out", "what did I do today", or "answer my morning check-in".',
      )
      .reprompt('What do you want to do?')
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
