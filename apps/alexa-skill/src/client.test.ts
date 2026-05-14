import { describe, it, expect } from 'vitest';
import { filterUpcoming } from './handlers/today.js';

/**
 * §50 Phase F — the skill's surface slimmed down to a single intent
 * (`WhatsLeftIntent`) backed by `GET /api/calendar/today`. The
 * `fuzzyMatch` + `relativeTime` helpers retired with the intents that used
 * them (TodayBrief, MarkDone, Swap, etc. — see Phase C deletes).
 *
 * Tests left here cover the only pure helper still in the skill:
 * `filterUpcoming` (decides which events get spoken).
 */

interface E {
  id: string;
  summary: string;
  start: string;
  is_all_day: boolean;
}

const NOW = new Date('2026-05-14T12:00:00-07:00');

describe('filterUpcoming', () => {
  it('drops timed events that have already started', () => {
    const events: E[] = [
      { id: '1', summary: 'Past meeting', start: '2026-05-14T10:00:00-07:00', is_all_day: false },
      { id: '2', summary: 'Soon', start: '2026-05-14T14:00:00-07:00', is_all_day: false },
    ];
    const result = filterUpcoming(events, NOW);
    expect(result.map((e) => e.id)).toEqual(['2']);
  });

  it('keeps all-day events even when "now" is mid-day', () => {
    const events: E[] = [
      { id: '1', summary: 'Quarterly maintenance', start: '2026-05-14', is_all_day: true },
    ];
    const result = filterUpcoming(events, NOW);
    expect(result.map((e) => e.id)).toEqual(['1']);
  });

  it('drops events with no start time', () => {
    const events: E[] = [
      { id: '1', summary: 'Missing start', start: '', is_all_day: false },
    ];
    expect(filterUpcoming(events, NOW)).toEqual([]);
  });

  it('drops events with unparseable start', () => {
    const events: E[] = [
      { id: '1', summary: 'Garbage start', start: 'not-a-date', is_all_day: false },
    ];
    expect(filterUpcoming(events, NOW)).toEqual([]);
  });

  it('returns empty when nothing is upcoming', () => {
    const events: E[] = [
      { id: '1', summary: 'Morning thing', start: '2026-05-14T08:00:00-07:00', is_all_day: false },
      { id: '2', summary: 'Lunch', start: '2026-05-14T11:30:00-07:00', is_all_day: false },
    ];
    expect(filterUpcoming(events, NOW)).toEqual([]);
  });

  it('returns events in input order (does not re-sort)', () => {
    const events: E[] = [
      { id: '1', summary: 'Later', start: '2026-05-14T17:00:00-07:00', is_all_day: false },
      { id: '2', summary: 'Sooner', start: '2026-05-14T14:00:00-07:00', is_all_day: false },
      { id: '3', summary: 'Past', start: '2026-05-14T09:00:00-07:00', is_all_day: false },
    ];
    // Sorting (if needed) is the caller's responsibility — Google's events.list
    // already returns chronological order by default.
    const result = filterUpcoming(events, NOW);
    expect(result.map((e) => e.id)).toEqual(['1', '2']);
  });
});
