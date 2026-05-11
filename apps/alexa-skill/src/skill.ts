import { SkillBuilders, type Skill } from 'ask-sdk-core';
import {
  CancelStopHandler,
  ErrorHandlerImpl,
  FallbackHandler,
  HelpHandler,
  LaunchRequestHandler,
  SessionEndedHandler,
} from './handlers/core.js';
import {
  MarkDoneHandler,
  PullFromPoolHandler,
  SwapTaskHandler,
  TodayBriefHandler,
  WhatsLeftHandler,
} from './handlers/today.js';
import {
  LogMoodHandler,
  LogWorkoutHandler,
  TodaysWorkoutHandler,
  UpdateEnergyHandler,
} from './handlers/wellbeing.js';
import { AddTaskHandler, AssessZoneHandler } from './handlers/zones.js';
import {
  AnswerMorningCheckInHandler,
  ListPendingCheckInsHandler,
} from './handlers/checkins.js';
import {
  AskHouseholdHandler,
  PatternsHandler,
  WhatDidIDoHandler,
} from './handlers/info.js';

const builder = SkillBuilders.custom()
  .addRequestHandlers(
    LaunchRequestHandler,
    TodayBriefHandler,
    WhatsLeftHandler,
    SwapTaskHandler,
    MarkDoneHandler,
    PullFromPoolHandler,
    UpdateEnergyHandler,
    LogMoodHandler,
    TodaysWorkoutHandler,
    LogWorkoutHandler,
    AssessZoneHandler,
    AddTaskHandler,
    ListPendingCheckInsHandler,
    AnswerMorningCheckInHandler,
    WhatDidIDoHandler,
    PatternsHandler,
    AskHouseholdHandler,
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
