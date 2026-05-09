import {
  type RequestHandler,
  getSlotValue,
  getIntentName,
  getRequestType,
} from 'ask-sdk-core';
import {
  apiClient,
  type EnergyLevel,
  type MoodLevel,
  type WorkoutStatus,
} from '../client.js';

const VALID_ENERGY: EnergyLevel[] = ['low', 'medium', 'high'];
const VALID_MOOD: MoodLevel[] = ['good', 'neutral', 'down'];
const VALID_WORKOUT: WorkoutStatus[] = ['done', 'skipped', 'partial'];

export const UpdateEnergyHandler: RequestHandler = {
  canHandle(input) {
    return (
      getRequestType(input.requestEnvelope) === 'IntentRequest' &&
      getIntentName(input.requestEnvelope) === 'UpdateEnergyIntent'
    );
  },
  async handle(input) {
    const level = getSlotValue(input.requestEnvelope, 'EnergyLevel') as
      | EnergyLevel
      | undefined;
    if (!level || !VALID_ENERGY.includes(level)) {
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
    if (out > 0)
      parts.push(
        `I'd defer ${sug.suggested_swaps_out.map((s) => s.name).join(', ')}`,
      );
    if (inn > 0)
      parts.push(
        `pull in ${sug.suggested_swaps_in.map((s) => s.name).join(', ')}`,
      );
    return input.responseBuilder
      .speak(`Energy ${level}. ${parts.join('; and ')}. Apply in the dashboard?`)
      .getResponse();
  },
};

export const LogMoodHandler: RequestHandler = {
  canHandle(input) {
    return (
      getRequestType(input.requestEnvelope) === 'IntentRequest' &&
      getIntentName(input.requestEnvelope) === 'LogMoodIntent'
    );
  },
  async handle(input) {
    const level = getSlotValue(input.requestEnvelope, 'MoodLevel') as
      | MoodLevel
      | undefined;
    if (!level || !VALID_MOOD.includes(level)) {
      return input.responseBuilder
        .speak('Mood needs to be good, neutral, or down.')
        .getResponse();
    }
    await apiClient.setMood(level);
    return input.responseBuilder
      .speak(`Mood logged as ${level}.`)
      .getResponse();
  },
};

export const TodaysWorkoutHandler: RequestHandler = {
  canHandle(input) {
    return (
      getRequestType(input.requestEnvelope) === 'IntentRequest' &&
      getIntentName(input.requestEnvelope) === 'TodaysWorkoutIntent'
    );
  },
  async handle(input) {
    const today = await apiClient.todaysWorkout();
    if (!today.slot) {
      return input.responseBuilder
        .speak('No protected workout slot today.')
        .getResponse();
    }
    if (today.log) {
      return input.responseBuilder
        .speak(
          `Today's workout, ${today.slot.name}, is logged as ${today.log.status}.`,
        )
        .getResponse();
    }
    return input.responseBuilder
      .speak(`Today's workout: ${today.slot.name}. Not logged yet.`)
      .reprompt('Want to log it?')
      .getResponse();
  },
};

export const LogWorkoutHandler: RequestHandler = {
  canHandle(input) {
    return (
      getRequestType(input.requestEnvelope) === 'IntentRequest' &&
      getIntentName(input.requestEnvelope) === 'LogWorkoutIntent'
    );
  },
  async handle(input) {
    const status = (getSlotValue(input.requestEnvelope, 'Status') ??
      'done') as WorkoutStatus;
    if (!VALID_WORKOUT.includes(status)) {
      return input.responseBuilder
        .speak('Workout status needs to be done, partial, or skipped.')
        .getResponse();
    }
    const today = await apiClient.todaysWorkout();
    const slot = today.slot?.slot_key ?? 'ad_hoc';
    await apiClient.logWorkout(slot, status);
    return input.responseBuilder
      .speak(`Workout logged: ${status}.`)
      .getResponse();
  },
};
