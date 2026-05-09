import { Trigger } from '../db/models/Trigger.js';
import { ymd } from '../utils/dates.js';
import { logActivity } from './activity.js';
import type { TriggerType } from '@household-os/shared/types';

export async function listUpcomingTriggers() {
  const today = ymd(new Date());
  return Trigger.find({ date: { $gte: today } })
    .sort({ date: 1 })
    .lean();
}

export async function addTrigger(input: {
  type: TriggerType;
  date: string;
  notes?: string;
}) {
  const created = await Trigger.create({
    type: input.type,
    date: input.date,
    source: 'manual',
    ingested_at: new Date(),
    notes: input.notes,
  });
  await logActivity('trigger_added', `Trigger: ${input.type} on ${input.date}`, {
    metadata: { type: input.type, date: input.date, source: 'manual' },
  });
  return created;
}
