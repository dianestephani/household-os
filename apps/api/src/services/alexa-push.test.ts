import { describe, it, expect } from 'vitest';
import { buildCheckInCardBody } from './alexa-push.js';

describe('buildCheckInCardBody', () => {
  it('returns the morning_intent template', () => {
    const body = buildCheckInCardBody({ type: 'morning_intent' });
    expect(body).toMatch(/Morning check-in pending/);
    expect(body).toMatch(/Home Ops/); // mentions the invocation name
  });

  it('formats a frequent_deferral pattern interrupt with routine name + count', () => {
    const body = buildCheckInCardBody({
      type: 'pattern_interrupt',
      context: {
        kind: 'frequent_deferral',
        routine_name: 'Yard pickup',
        count: 3,
      },
    });
    expect(body).toContain('Yard pickup');
    expect(body).toContain('3 times');
    expect(body).toMatch(/push through, swap, or adjust the cadence/);
  });

  it('handles missing count on frequent_deferral by defaulting to 0', () => {
    const body = buildCheckInCardBody({
      type: 'pattern_interrupt',
      context: { kind: 'frequent_deferral', routine_name: 'Trash prep' },
    });
    expect(body).toContain('0 times');
  });

  it('formats a missed_workouts pattern interrupt', () => {
    const body = buildCheckInCardBody({
      type: 'pattern_interrupt',
      context: { kind: 'missed_workouts', count: 5 },
    });
    expect(body).toContain('5 workouts');
    expect(body).toMatch(/What's the plan/);
  });

  it('falls back to a generic message for unknown pattern_interrupt kinds', () => {
    const body = buildCheckInCardBody({
      type: 'pattern_interrupt',
      context: { kind: 'unknown_pattern' },
    });
    expect(body).toBe('Pattern interrupt: open Home Ops to address it.');
  });

  it('falls back to generic when frequent_deferral is missing the routine_name', () => {
    // Without a routine name there's nothing meaningful to say, so the
    // generic fallback should fire rather than producing "undefined has been
    // deferred N times."
    const body = buildCheckInCardBody({
      type: 'pattern_interrupt',
      context: { kind: 'frequent_deferral', count: 2 },
    });
    expect(body).toBe('Pattern interrupt: open Home Ops to address it.');
  });

  it('returns null for check-in types we deliberately do NOT push', () => {
    expect(buildCheckInCardBody({ type: 'evening_retro' })).toBeNull();
    expect(buildCheckInCardBody({ type: 'weekly_review' })).toBeNull();
    expect(buildCheckInCardBody({ type: 'zone_assessment' })).toBeNull();
  });

  it('returns null for an unknown check-in type', () => {
    expect(buildCheckInCardBody({ type: 'fictional' })).toBeNull();
  });
});
