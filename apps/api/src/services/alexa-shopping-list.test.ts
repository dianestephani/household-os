import { describe, it, expect } from 'vitest';
import { addItemsToShoppingList } from './alexa-shopping-list.js';

/**
 * `getValidAccessToken` short-circuits to null in NODE_ENV=test (set by
 * vitest automatically). That means every test here exercises the
 * "no token configured" path — which is the right behavior: tests should
 * never accidentally hit Amazon's real API even with a stray env var.
 */

describe('addItemsToShoppingList — NODE_ENV=test path', () => {
  it('returns status=no_token with per-item error when LWA is not configured', async () => {
    const result = await addItemsToShoppingList(['eggs', 'milk']);
    expect(result.status).toBe('no_token');
    expect(result.added).toBe(0);
    expect(result.failed).toBe(2);
    expect(result.results.every((r) => r.status === 'error')).toBe(true);
    expect(result.results[0]?.error).toMatch(/permission|configured/i);
  });

  it('skips empty + whitespace-only items', async () => {
    const result = await addItemsToShoppingList(['', '   ', 'real item']);
    expect(result.results.length).toBe(1);
    expect(result.results[0]?.text).toBe('real item');
  });

  it('caps the input at 100 items', async () => {
    const many = Array.from({ length: 150 }, (_, i) => `item ${i}`);
    const result = await addItemsToShoppingList(many);
    expect(result.results.length).toBe(100);
  });

  it('returns the empty-input no-op cleanly (status=ok)', async () => {
    const result = await addItemsToShoppingList([]);
    expect(result.status).toBe('ok');
    expect(result.added).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.results).toEqual([]);
  });
});
