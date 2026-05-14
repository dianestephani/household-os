import { SkillBuilders, type Skill } from 'ask-sdk-core';
import {
  CancelStopHandler,
  ErrorHandlerImpl,
  FallbackHandler,
  HelpHandler,
  LaunchRequestHandler,
  SessionEndedHandler,
} from './handlers/core.js';
import { WhatsLeftHandler } from './handlers/today.js';

/**
 * §50 Phase F — slimmed skill. The only remaining household-specific intent
 * is `WhatsLeftIntent`, which now reads today's incomplete Calendar events
 * (was: incomplete TodayPlan items before TodayPlan retired in Phase C).
 * Everything else — TodayBrief, Swap, MarkDone, PullFromPool, UpdateEnergy,
 * LogMood, LogWorkout, TodaysWorkout, AssessZone, AddTask,
 * AnswerMorningCheckIn, ListPendingCheckIns, WhatDidIDo, Patterns,
 * AskHousehold — retired with their underlying endpoints.
 *
 * Core built-ins (Launch, Help, Cancel/Stop, Fallback, SessionEnded, Error)
 * stay because Alexa requires them.
 */
const builder = SkillBuilders.custom()
  .addRequestHandlers(
    LaunchRequestHandler,
    WhatsLeftHandler,
    HelpHandler,
    CancelStopHandler,
    FallbackHandler,
    SessionEndedHandler,
  )
  .addErrorHandlers(ErrorHandlerImpl);

/** Configured Alexa Skill — used by the Express adapter and Lambda export. */
export const skill: Skill = builder.create();

/** Lambda handler — only used if you deploy this skill as an AWS Lambda. */
export const handler = builder.lambda();
