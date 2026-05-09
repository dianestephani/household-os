import { describe, it, expect } from 'vitest';
import { fuzzyMatch, relativeTime, type PlanItem } from './client.js';

const items: PlanItem[] = [
  { routine_key: 'litter_scoop', name: 'Scoop both litter boxes', estimate_minutes: 8, energy: 'low', status: 'pending' },
  { routine_key: 'trash_prep', name: 'Bins to curb + swap liners', estimate_minutes: 20, energy: 'low', status: 'pending' },
  { routine_key: 'kitchen_reset', name: 'Counter + sink reset', estimate_minutes: 8, energy: 'low', status: 'pending' },
];

describe('fuzzyMatch', () => {
  it('matches exact name', () => {
    const m = fuzzyMatch(items, 'Counter + sink reset');
    expect(m?.routine_key).toBe('kitchen_reset');
  });

  it('matches case-insensitively', () => {
    const m = fuzzyMatch(items, 'COUNTER + SINK RESET');
    expect(m?.routine_key).toBe('kitchen_reset');
  });

  it('matches by partial substring (slot phrase contained in name)', () => {
    const m = fuzzyMatch(items, 'litter');
    expect(m?.routine_key).toBe('litter_scoop');
  });

  it('matches when slot phrase fully contains the routine name', () => {
    const m = fuzzyMatch(items, 'oh yeah counter + sink reset right now');
    expect(m?.routine_key).toBe('kitchen_reset');
  });

  it('returns null on no match', () => {
    expect(fuzzyMatch(items, 'walk the dog')).toBeNull();
  });

  it('returns null on empty phrase', () => {
    expect(fuzzyMatch(items, '')).toBeNull();
  });
});

describe('relativeTime', () => {
  it('reports "just now" for recent timestamps', () => {
    const ts = new Date(Date.now() - 10_000).toISOString();
    expect(relativeTime(ts)).toBe('just now');
  });

  it('reports minutes for sub-hour gaps', () => {
    const ts = new Date(Date.now() - 8 * 60_000).toISOString();
    expect(relativeTime(ts)).toMatch(/^\d+ minutes? ago$/);
  });

  it('reports hours when between 1 and 24', () => {
    const ts = new Date(Date.now() - 5 * 60 * 60_000).toISOString();
    expect(relativeTime(ts)).toMatch(/^\d+ hours? ago$/);
  });

  it('reports days when over 24 hours', () => {
    const ts = new Date(Date.now() - 3 * 24 * 60 * 60_000).toISOString();
    expect(relativeTime(ts)).toMatch(/^\d+ days? ago$/);
  });
});
