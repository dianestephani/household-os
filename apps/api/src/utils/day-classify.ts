import { addDays, dayOfWeek, isWeekend } from './dates.js';
import { listEvents } from './google-calendar.js';
import type { DayType } from '@household-os/shared/types';

export async function classifyDay(d: Date): Promise<DayType> {
  const start = new Date(d);
  start.setHours(0, 0, 0, 0);
  const end = addDays(start, 1);
  const events = await listEvents(start.toISOString(), end.toISOString());

  let hasCatering = false;
  let hasMorningPT = false;

  for (const ev of events) {
    const title = (ev.summary ?? '').toLowerCase();
    const description = (ev.description ?? '').toLowerCase();
    // Catering: match "catering" anywhere, or "landmark" (covers
    // "landmarkeventco" too) in either title or description.
    if (
      title.includes('catering') ||
      title.includes('landmark') ||
      description.includes('catering') ||
      description.includes('landmark')
    ) {
      hasCatering = true;
    }
    // PT/gym: title-only match (description matching "session" would over-fire
    // on non-workout events like "brainstorming session").
    if (title.match(/\b(pt|physical therapy|gym|session)\b/)) {
      const startStr = ev.start?.dateTime;
      if (startStr) {
        const h = new Date(startStr).getHours();
        if (h < 12) hasMorningPT = true;
      } else if (ev.start?.date) {
        hasMorningPT = true;
      }
    }
  }

  if (hasCatering) return 'catering_day';

  const dow = dayOfWeek(d);
  if ((dow === 'tue' || dow === 'thu') && hasMorningPT) return 'tue_thu_pt';

  if (isWeekend(d) && events.length === 0) return 'day_off';

  return 'weekday_default';
}
