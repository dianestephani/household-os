import { describe, it, expect } from 'vitest';
import { fuzzyMatch, type PlanItem } from './client.js';

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
