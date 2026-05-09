/**
 * Public surface of the skill package. Two exports:
 *
 * - `skill` — the configured `Skill` object. Used by the Express adapter
 *   mounted on the API server (this is the recommended deployment path).
 * - `handler` — Lambda handler, in case you want to deploy via AWS Lambda
 *   instead.
 *
 * The actual intent handlers live in `./handlers/*.ts`.
 */
export { handler, skill } from './skill.js';
export { apiClient, fuzzyMatch, relativeTime } from './client.js';
export type {
  ActivityEntry,
  CheckIn,
  CheckInQuestion,
  DeferReason,
  EnergyLevel,
  EnergySuggestion,
  MoodLevel,
  PlanItem,
  TodayPlan,
  WorkoutSlot,
  WorkoutStatus,
  Zone,
  ZoneLevel,
} from './client.js';
