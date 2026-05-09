import {
  type RequestHandler,
  getSlotValue,
  getIntentName,
  getRequestType,
} from 'ask-sdk-core';
import { apiClient, type Zone, type ZoneLevel } from '../client.js';

const VALID_ZONES: Zone[] = [
  'kitchen',
  'bathrooms',
  'common',
  'bedroom',
  'yard',
  'whole-house',
];
const VALID_LEVELS: ZoneLevel[] = ['fine', 'meh', 'rough'];

/**
 * Map alternate slot pronunciations Alexa might capture (e.g. "common areas",
 * "the bathroom") back to canonical zone keys.
 */
function normalizeZone(raw: string | undefined): Zone | null {
  if (!raw) return null;
  const r = raw.toLowerCase().trim();
  if (r === 'kitchen') return 'kitchen';
  if (r.startsWith('bathroom')) return 'bathrooms';
  if (r.includes('common')) return 'common';
  if (r === 'bedroom') return 'bedroom';
  if (r === 'yard' || r === 'lawn') return 'yard';
  if (r.includes('whole') || r === 'house' || r === 'overall') return 'whole-house';
  if ((VALID_ZONES as string[]).includes(r)) return r as Zone;
  return null;
}

function normalizeLevel(raw: string | undefined): ZoneLevel | null {
  if (!raw) return null;
  const r = raw.toLowerCase().trim();
  if (r === 'fine' || r === 'good' || r === 'great') return 'fine';
  if (r === 'meh' || r === 'okay' || r === 'ok' || r === 'mediocre') return 'meh';
  if (r === 'rough' || r === 'bad' || r === 'terrible' || r === 'gross')
    return 'rough';
  if ((VALID_LEVELS as string[]).includes(r)) return r as ZoneLevel;
  return null;
}

export const AssessZoneHandler: RequestHandler = {
  canHandle(input) {
    return (
      getRequestType(input.requestEnvelope) === 'IntentRequest' &&
      getIntentName(input.requestEnvelope) === 'AssessZoneIntent'
    );
  },
  async handle(input) {
    const zoneRaw = getSlotValue(input.requestEnvelope, 'Zone');
    const levelRaw = getSlotValue(input.requestEnvelope, 'ZoneLevel');
    const zone = normalizeZone(zoneRaw);
    const level = normalizeLevel(levelRaw);
    if (!zone) {
      return input.responseBuilder
        .speak(`I didn't catch the zone. Try kitchen, bathrooms, or yard.`)
        .getResponse();
    }
    if (!level) {
      return input.responseBuilder
        .speak('How is it — fine, meh, or rough?')
        .getResponse();
    }
    await apiClient.assessZone(zone, level);
    const speech =
      level === 'fine'
        ? `Got it — ${zone} is ${level}.`
        : `Got it — ${zone} is ${level}. I added a task.`;
    return input.responseBuilder.speak(speech).getResponse();
  },
};
