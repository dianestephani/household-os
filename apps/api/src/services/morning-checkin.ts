import { MorningCheckin, type MorningCheckinDoc } from '../db/models/MorningCheckin.js';
import { logActivity } from './activity.js';
import { ymd } from '../utils/dates.js';
import type {
  AwakenessLevel,
  EnergyLevel,
  MoodLevel,
  MorningCheckin as MorningCheckinType,
  MorningCheckinInput,
} from '@household-os/shared/types';

/**
 * §50 Phase B — one morning check-in per local date. Replaces MoodLog +
 * EnergyLog + the morning-intent check-in flow with a single document that
 * carries mood + energy + awakeness + optional note.
 *
 * Service shape mirrors the spec block: `upsertCheckin`, `getCheckin`,
 * `recentCheckins`. Activity log fires on every upsert (insert OR update) so
 * Look Back can surface "you logged at 2:15 PM" timestamps. The dashboard's
 * MorningCheckinForm hits this directly; the unified assistant exposes
 * `get_morning_checkin` + `recent_checkins` tools on top.
 */

const VALID_MOOD: MoodLevel[] = ['good', 'neutral', 'down'];
const VALID_ENERGY: EnergyLevel[] = ['low', 'medium', 'high'];
const VALID_AWAKENESS: AwakenessLevel[] = ['groggy', 'meh', 'alert'];

function isValidDate(s: string | undefined): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function todayYmd(): string {
  return ymd(new Date());
}

function toView(doc: MorningCheckinDoc): MorningCheckinType {
  return {
    _id: String((doc as { _id?: unknown })._id ?? ''),
    date: doc.date,
    mood: doc.mood as MoodLevel,
    energy: doc.energy as EnergyLevel,
    awakeness: doc.awakeness as AwakenessLevel,
    note: doc.note ?? '',
    created_at: doc.created_at as Date,
    updated_at: doc.updated_at as Date,
  };
}

export async function getCheckin(
  date?: string,
): Promise<MorningCheckinType | null> {
  const target = isValidDate(date) ? date : todayYmd();
  const doc = await MorningCheckin.findOne({ date: target }).lean();
  return doc ? toView(doc as MorningCheckinDoc) : null;
}

export async function recentCheckins(
  days = 14,
): Promise<MorningCheckinType[]> {
  const safe = Math.max(1, Math.min(Math.floor(days || 14), 90));
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - (safe - 1));
  const cutoffKey = ymd(cutoff);

  const docs = await MorningCheckin.find({ date: { $gte: cutoffKey } })
    .sort({ date: -1 })
    .lean();
  return docs.map((d) => toView(d as MorningCheckinDoc));
}

export async function upsertCheckin(
  input: MorningCheckinInput,
): Promise<MorningCheckinType> {
  if (!VALID_MOOD.includes(input.mood)) {
    throw new Error(`invalid mood: ${input.mood}`);
  }
  if (!VALID_ENERGY.includes(input.energy)) {
    throw new Error(`invalid energy: ${input.energy}`);
  }
  if (!VALID_AWAKENESS.includes(input.awakeness)) {
    throw new Error(`invalid awakeness: ${input.awakeness}`);
  }

  const date = isValidDate(input.date) ? input.date : todayYmd();
  const note = (input.note ?? '').trim().slice(0, 500);

  // Detect insert-vs-update so we can phrase the activity-log entry
  // accurately — "logged" on insert, "updated" on edit.
  const existing = await MorningCheckin.findOne({ date }).lean();
  const wasInsert = !existing;
  const now = new Date();

  const updated = await MorningCheckin.findOneAndUpdate(
    { date },
    {
      $set: {
        mood: input.mood,
        energy: input.energy,
        awakeness: input.awakeness,
        note,
        updated_at: now,
      },
      $setOnInsert: { date, created_at: now },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();

  const summary = wasInsert
    ? `Morning check-in: mood=${input.mood} energy=${input.energy} awakeness=${input.awakeness}`
    : `Morning check-in updated for ${date}`;
  await logActivity('morning_checkin_logged', summary, {
    metadata: {
      date,
      mood: input.mood,
      energy: input.energy,
      awakeness: input.awakeness,
      has_note: Boolean(note),
      operation: wasInsert ? 'create' : 'update',
    },
  });

  return toView(updated as MorningCheckinDoc);
}
