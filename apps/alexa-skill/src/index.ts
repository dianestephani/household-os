/**
 * Public surface of the skill package. Two exports:
 *
 * - `skill` — the configured `Skill` object. Used by the Express adapter
 *   mounted on the API server (this is the recommended deployment path).
 * - `handler` — Lambda handler, in case you want to deploy via AWS Lambda
 *   instead.
 *
 * §50 Phase F — surface trimmed to match the remaining `WhatsLeftIntent`.
 * The fuzzy-match + relative-time helpers retired with the intents that
 * used them. Most type exports retired too — `CalendarEvent` and
 * `CalendarDayResponse` are the only ones left.
 */
export { handler, skill } from './skill.js';
export { apiClient } from './client.js';
export type { CalendarEvent, CalendarDayResponse } from './client.js';
