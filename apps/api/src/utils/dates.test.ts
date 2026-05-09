import { describe, it, expect } from 'vitest';
import { ymd, parseYmd, dayOfWeek, addDays, diffDays, isWeekend } from './dates.js';

describe('dates utilities', () => {
  it('formats local date as YYYY-MM-DD', () => {
    const d = new Date(2026, 4, 9); // 2026-05-09
    expect(ymd(d)).toBe('2026-05-09');
  });

  it('round-trips parseYmd → ymd', () => {
    const s = '2026-05-09';
    expect(ymd(parseYmd(s))).toBe(s);
  });

  it('reports day of week', () => {
    expect(dayOfWeek(new Date(2026, 4, 9))).toBe('sat'); // 2026-05-09 is a Saturday
    expect(dayOfWeek(new Date(2026, 4, 12))).toBe('tue');
  });

  it('addDays moves forward and backward', () => {
    const d = new Date(2026, 4, 9);
    expect(ymd(addDays(d, 1))).toBe('2026-05-10');
    expect(ymd(addDays(d, -2))).toBe('2026-05-07');
    expect(ymd(addDays(d, 7))).toBe('2026-05-16');
  });

  it('diffDays returns whole-day deltas', () => {
    const a = new Date(2026, 4, 12);
    const b = new Date(2026, 4, 5);
    expect(diffDays(a, b)).toBe(7);
    expect(diffDays(b, a)).toBe(-7);
  });

  it('isWeekend tags Sat + Sun', () => {
    expect(isWeekend(new Date(2026, 4, 9))).toBe(true);  // Sat
    expect(isWeekend(new Date(2026, 4, 10))).toBe(true); // Sun
    expect(isWeekend(new Date(2026, 4, 12))).toBe(false); // Tue
  });
});
