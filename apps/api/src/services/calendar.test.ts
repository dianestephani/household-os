import { describe, it, expect } from 'vitest';
import {
  dayRange,
  normalizeEvent,
  openInCalendarUrl,
  todaysEvents,
} from './calendar.js';

describe('dayRange', () => {
  it('spans local midnight to next-day midnight', () => {
    const noon = new Date(2026, 4, 9, 14, 30, 17); // 2026-05-09 14:30:17 local
    const { startIso, endIso } = dayRange(noon);
    const start = new Date(startIso);
    const end = new Date(endIso);
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
    expect(start.getDate()).toBe(9);
    expect(end.getDate()).toBe(10);
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
  });
});

describe('openInCalendarUrl', () => {
  it('zero-pads month and day for the day-view permalink', () => {
    const url = openInCalendarUrl(new Date(2026, 0, 5)); // 2026-01-05
    expect(url).toBe('https://calendar.google.com/calendar/u/0/r/day/2026/01/05');
  });
});

describe('normalizeEvent', () => {
  it('shapes a timed event with htmlLink + location', () => {
    const e = normalizeEvent({
      id: 'abc',
      summary: 'PT session',
      start: { dateTime: '2026-05-09T15:00:00-07:00' },
      end: { dateTime: '2026-05-09T16:00:00-07:00' },
      location: 'gym',
      htmlLink: 'https://calendar.google.com/event?eid=xyz',
    });
    expect(e).toEqual({
      id: 'abc',
      summary: 'PT session',
      start: '2026-05-09T15:00:00-07:00',
      end: '2026-05-09T16:00:00-07:00',
      is_all_day: false,
      location: 'gym',
      html_link: 'https://calendar.google.com/event?eid=xyz',
    });
  });

  it('flags an all-day event (date-only start/end)', () => {
    const e = normalizeEvent({
      id: 'all',
      summary: 'Landscaper',
      start: { date: '2026-05-09' },
      end: { date: '2026-05-10' },
    });
    expect(e?.is_all_day).toBe(true);
    expect(e?.start).toBe('2026-05-09');
  });

  it("falls back to '(no title)' when summary is missing", () => {
    const e = normalizeEvent({
      id: 'untitled',
      start: { dateTime: '2026-05-09T15:00:00Z' },
      end: { dateTime: '2026-05-09T16:00:00Z' },
    });
    expect(e?.summary).toBe('(no title)');
  });

  it('returns null when id, start, or end is missing', () => {
    expect(
      normalizeEvent({
        summary: 'no-id',
        start: { dateTime: '2026-05-09T15:00:00Z' },
        end: { dateTime: '2026-05-09T16:00:00Z' },
      }),
    ).toBeNull();
    expect(normalizeEvent({ id: 'x', start: {}, end: {} })).toBeNull();
  });
});

describe('todaysEvents', () => {
  it('returns connected=false in test mode with the day permalink', async () => {
    // NODE_ENV=test forces the connection check to false (see
    // utils/google-calendar.ts) so the response is deterministic regardless
    // of whether the developer has local OAuth creds on disk.
    const now = new Date(2026, 4, 9, 12);
    const res = await todaysEvents(now);
    expect(res.connected).toBe(false);
    expect(res.events).toEqual([]);
    expect(res.date).toBe('2026-05-09');
    expect(res.open_in_calendar_url).toBe(
      'https://calendar.google.com/calendar/u/0/r/day/2026/05/09',
    );
  });
});
