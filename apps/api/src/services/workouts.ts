import { WorkoutLog } from '../db/models/WorkoutLog.js';
import { dayOfWeek, ymd } from '../utils/dates.js';
import inventory from '@household-os/shared/inventory.json' with { type: 'json' };
import type {
  EnergyLevel,
  MoodLevel,
  WorkoutSlotKey,
  WorkoutStatus,
} from '@household-os/shared/types';

interface SlotInfo {
  slot_key: WorkoutSlotKey;
  name: string;
  type: string;
}

/**
 * Returns the protected workout slot expected today based on day-of-week.
 * `lift_flex` is "any weekday" — we surface it on weekdays that don't already
 * have a PT session.
 */
export function todaysSlot(date: Date = new Date()): SlotInfo | null {
  const dow = dayOfWeek(date);
  const slots = inventory.protected_slots;

  if (dow === 'tue') {
    const pt = slots.find((s) => s.key === 'pt_tue');
    if (pt) return { slot_key: 'pt_tue', name: pt.name, type: pt.type };
  }
  if (dow === 'thu') {
    const pt = slots.find((s) => s.key === 'pt_thu');
    if (pt) return { slot_key: 'pt_thu', name: pt.name, type: pt.type };
  }
  if (['mon', 'wed', 'fri'].includes(dow)) {
    const flex = slots.find((s) => s.key === 'lift_flex');
    if (flex) return { slot_key: 'lift_flex', name: flex.name, type: flex.type };
  }
  return null;
}

export async function todaysWorkout(date: Date = new Date()) {
  const slot = todaysSlot(date);
  if (!slot) return { slot: null, log: null };
  const log = await WorkoutLog.findOne({
    date: ymd(date),
    slot_key: slot.slot_key,
  }).lean();
  return { slot, log };
}

export async function logWorkout(input: {
  slot_key: WorkoutSlotKey;
  status: WorkoutStatus;
  date?: string;
  mood?: MoodLevel;
  energy?: EnergyLevel;
  notes?: string;
}) {
  const date = input.date ?? ymd(new Date());
  return WorkoutLog.findOneAndUpdate(
    { date, slot_key: input.slot_key },
    {
      $set: {
        status: input.status,
        mood: input.mood,
        energy: input.energy,
        notes: input.notes,
        ts: new Date(),
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();
}

export async function recentWorkouts(days = 14) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return WorkoutLog.find({ ts: { $gte: since } })
    .sort({ date: -1 })
    .lean();
}
