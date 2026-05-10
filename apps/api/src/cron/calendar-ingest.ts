import { Trigger } from '../db/models/Trigger.js';
import { addDays, ymd } from '../utils/dates.js';
import { listEvents } from '../utils/google-calendar.js';
import type { TriggerType } from '@household-os/shared/types';

interface KeywordRule {
  pattern: RegExp;
  type: TriggerType;
}

const TITLE_RULES: KeywordRule[] = [
  { pattern: /airbnb.*(check[- ]?in|arrival)/i, type: 'airbnb_checkin' },
  { pattern: /airbnb.*(check[- ]?out|departure)/i, type: 'airbnb_checkout' },
  { pattern: /dogsit.*(arrival|drop[- ]?off)/i, type: 'dogsit_arrival' },
  { pattern: /dogsit.*(departure|pick[- ]?up)/i, type: 'dogsit_departure' },
  { pattern: /landscaper|lawn|yard service/i, type: 'landscaper' },
  { pattern: /house ?clean(ing|er)|cleaner visit/i, type: 'cleaner_visit' },
];

export function classifyEventTitle(title: string | null | undefined): TriggerType | null {
  if (!title) return null;
  for (const rule of TITLE_RULES) {
    if (rule.pattern.test(title)) return rule.type;
  }
  return null;
}

export async function ingestCalendarTriggers(now: Date = new Date()): Promise<void> {
  const start = now;
  const end = addDays(now, 14);
  const events = await listEvents(start.toISOString(), end.toISOString());

  let added = 0;
  for (const ev of events) {
    const title = ev.summary ?? '';
    const type = classifyEventTitle(title);
    if (!type) continue;

    const dateStr = ev.start?.date ?? ev.start?.dateTime;
    if (!dateStr) continue;
    const date = ymd(new Date(dateStr));

    if (!ev.id) continue;
    const existing = await Trigger.findOne({ source_event_id: ev.id });
    if (existing) continue;

    await Trigger.create({
      type,
      date,
      source: 'calendar',
      source_event_id: ev.id,
      ingested_at: new Date(),
      notes: title,
    });
    added += 1;
  }

  if (added > 0) {
    console.log(`[calendar-ingest] added ${added} triggers`);
  }
}
