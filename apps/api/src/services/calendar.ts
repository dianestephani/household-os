import type { calendar_v3 } from 'googleapis';
import { isCalendarConnected, listEvents } from '../utils/google-calendar.js';
import { ymd } from '../utils/dates.js';
import type {
  CalendarDayResponse,
  CalendarEvent,
} from '@household-os/shared/types';

/**
 * Local-day window: midnight today (inclusive) → midnight tomorrow (exclusive).
 * Returned as ISO strings ready for Google's events.list timeMin/timeMax.
 */
export function dayRange(now: Date): { startIso: string; endIso: string } {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

/**
 * Permalink that opens Google Calendar's web UI directly to the user's day
 * view for `date`. The /u/0/ path means "the first signed-in account" — works
 * for Diane's single-account setup.
 */
export function openInCalendarUrl(
  date: Date,
  view: 'day' | 'week' | 'month' = 'day',
): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `https://calendar.google.com/calendar/u/0/r/${view}/${y}/${m}/${d}`;
}

/**
 * Convert a Google Schema$Event into the trimmed shape the dashboard renders.
 * Returns null for events missing the bits we'd need to display them (no id,
 * no start, no end). All-day events use { date } instead of { dateTime } in
 * Google's schema.
 */
export function normalizeEvent(
  event: calendar_v3.Schema$Event,
): CalendarEvent | null {
  if (!event.id) return null;
  const start = event.start?.dateTime ?? event.start?.date ?? null;
  const end = event.end?.dateTime ?? event.end?.date ?? null;
  if (!start || !end) return null;

  return {
    id: event.id,
    summary: event.summary ?? '(no title)',
    start,
    end,
    is_all_day: !event.start?.dateTime,
    location: event.location ?? undefined,
    html_link: event.htmlLink ?? undefined,
  };
}

export async function todaysEvents(
  now: Date = new Date(),
): Promise<CalendarDayResponse> {
  const { startIso, endIso } = dayRange(now);
  const connected = isCalendarConnected();
  const raw = connected ? await listEvents(startIso, endIso) : [];
  const events = raw
    .map(normalizeEvent)
    .filter((e): e is CalendarEvent => e !== null);

  return {
    date: ymd(now),
    connected,
    events,
    open_in_calendar_url: openInCalendarUrl(now),
  };
}
