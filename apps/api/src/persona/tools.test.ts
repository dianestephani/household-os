import { describe, it, expect } from 'vitest';
import { ContextEntry } from '../db/models/ContextEntry.js';
import { householdTools, financeTools, getToolsForPersona } from './tools.js';
import { household } from '@household-os/shared/personas/household';
import { finance } from '@household-os/shared/personas/finance';

/**
 * The persona JSON tool schemas (in packages/shared/src/personas/*) and the
 * runtime implementations (in apps/api/src/persona/tools.ts) live in different
 * packages. These tests catch the silent-drift case where a tool is declared
 * in a persona's schema but no implementation exists (Claude would call the
 * tool and get an "unknown tool" failure at runtime).
 */
describe('persona tool wiring — every declared tool has an implementation', () => {
  it('every household persona tool has an entry in householdTools', () => {
    const declared = household.tools.map((t) => t.name);
    const implemented = Object.keys(householdTools);
    const missing = declared.filter((name) => !implemented.includes(name));
    expect(missing).toEqual([]);
  });

  it('every finance persona tool has an entry in financeTools', () => {
    const declared = finance.tools.map((t) => t.name);
    const implemented = Object.keys(financeTools);
    const missing = declared.filter((name) => !implemented.includes(name));
    expect(missing).toEqual([]);
  });

  it('getToolsForPersona returns the right map per persona', () => {
    expect(getToolsForPersona('household')).toBe(householdTools);
    expect(getToolsForPersona('finance')).toBe(financeTools);
    expect('not_implemented' in getToolsForPersona('grocery')).toBe(true);
  });
});

describe('log_context tool — both personas', () => {
  it('household.log_context writes a ContextEntry with related_persona=household by default', async () => {
    await householdTools.log_context!({
      text: '5 dogs, exhausted',
      energy: 'low',
      dogsit_count: 5,
      blocked_activities: ['workout'],
    });
    const entry = await ContextEntry.findOne({}).lean();
    expect(entry?.text).toBe('5 dogs, exhausted');
    expect(entry?.related_persona).toBe('household');
    expect(entry?.source).toBe('persona');
    expect(entry?.dogsit_count).toBe(5);
    expect(entry?.blocked_activities).toEqual(['workout']);
  });

  it('finance.log_context writes with related_persona=finance by default', async () => {
    await financeTools.log_context!({
      text: 'Got a $400 quote for housecleaning',
    });
    const entry = await ContextEntry.findOne({}).lean();
    expect(entry?.related_persona).toBe('finance');
    expect(entry?.source).toBe('persona');
  });

  it('explicit related_persona override is respected', async () => {
    await householdTools.log_context!({
      text: 'Chaos week — ordering takeout = extra spend',
      related_persona: 'both',
    });
    const entry = await ContextEntry.findOne({}).lean();
    expect(entry?.related_persona).toBe('both');
  });
});

describe('recent_context tool — both personas', () => {
  it('household.recent_context defaults to household-relevant entries', async () => {
    await ContextEntry.create({
      ts: new Date(),
      text: 'household-only',
      related_persona: 'household',
      source: 'api',
    });
    await ContextEntry.create({
      ts: new Date(),
      text: 'finance-only',
      related_persona: 'finance',
      source: 'api',
    });
    const result = (await householdTools.recent_context!({})) as Array<{
      text: string;
    }>;
    const texts = result.map((e) => e.text);
    expect(texts).toContain('household-only');
    expect(texts).not.toContain('finance-only');
  });

  it('finance.recent_context defaults to finance-relevant entries', async () => {
    await ContextEntry.create({
      ts: new Date(),
      text: 'finance-only',
      related_persona: 'finance',
      source: 'api',
    });
    await ContextEntry.create({
      ts: new Date(),
      text: 'household-only',
      related_persona: 'household',
      source: 'api',
    });
    const result = (await financeTools.recent_context!({})) as Array<{
      text: string;
    }>;
    const texts = result.map((e) => e.text);
    expect(texts).toContain('finance-only');
    expect(texts).not.toContain('household-only');
  });
});

describe('estimate_tax tool', () => {
  it('returns a TaxEstimate with computed components', async () => {
    const result = (await financeTools.estimate_tax!({
      monthly_gross_income: 5000,
      state: 'WA',
      filing_status: 'single',
      monthly_extra_withholding: 50,
    })) as {
      federal: number;
      fica: number;
      state_tax: number;
      extra: number;
      total: number;
    };
    expect(result.state_tax).toBe(0); // WA = no state tax
    expect(result.extra).toBe(50);
    expect(result.fica).toBeGreaterThan(0);
    expect(result.total).toBeCloseTo(
      result.federal + result.fica + result.state_tax + result.extra,
      1,
    );
  });

  it('falls back to zero gross when input is missing', async () => {
    const result = (await financeTools.estimate_tax!({})) as { total: number };
    expect(result.total).toBe(0);
  });
});
