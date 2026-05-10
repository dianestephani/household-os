import { describe, it, expect } from 'vitest';
import { ContextEntry } from '../db/models/ContextEntry.js';
import { ActivityLog } from '../db/models/ActivityLog.js';
import {
  addContext,
  contextOnDate,
  recentContext,
  todaysContext,
} from './context.js';

describe('addContext', () => {
  it('saves a minimal entry with defaults (related_persona=both, source=api)', async () => {
    const entry = await addContext({ text: '5 dogs today, exhausted' });
    expect(entry.text).toBe('5 dogs today, exhausted');
    expect(entry.related_persona).toBe('both');
    expect(entry.source).toBe('api');

    const all = await ContextEntry.find({}).lean();
    expect(all.length).toBe(1);
  });

  it('persists structured fields when provided', async () => {
    await addContext({
      text: 'Skipped workout, too tired from chaos',
      energy: 'low',
      mood: 'down',
      dogsit_count: 5,
      blocked_activities: ['workout', 'leave_house'],
      tags: ['dogsit-stress'],
      related_persona: 'household',
      source: 'dashboard',
    });
    const e = await ContextEntry.findOne({}).lean();
    expect(e?.energy).toBe('low');
    expect(e?.mood).toBe('down');
    expect(e?.dogsit_count).toBe(5);
    expect(e?.blocked_activities).toEqual(['workout', 'leave_house']);
    expect(e?.tags).toEqual(['dogsit-stress']);
    expect(e?.related_persona).toBe('household');
    expect(e?.source).toBe('dashboard');
  });

  it('strips empty arrays so they are not stored', async () => {
    await addContext({
      text: 'Quick note',
      tags: [],
      blocked_activities: [],
    });
    const e = await ContextEntry.findOne({}).lean();
    expect(e?.tags).toBeUndefined();
    expect(e?.blocked_activities).toBeUndefined();
  });

  it('rejects empty/whitespace-only text', async () => {
    await expect(addContext({ text: '   ' })).rejects.toThrow(/required/i);
    await expect(addContext({ text: '' })).rejects.toThrow(/required/i);
  });

  it('writes a context_logged activity log entry', async () => {
    await addContext({ text: 'Logged narrative', source: 'persona' });
    const log = await ActivityLog.findOne({ kind: 'context_logged' }).lean();
    expect(log).not.toBeNull();
    expect(log?.actor).toBe('system'); // persona-sourced entries are actor=system
    expect(log?.summary).toMatch(/Logged context/);
  });
});

describe('recentContext', () => {
  it('returns entries newest-first', async () => {
    await addContext({ text: 'first' });
    await new Promise((r) => setTimeout(r, 5));
    await addContext({ text: 'second' });
    const entries = await recentContext();
    expect(entries.map((e) => e.text)).toEqual(['second', 'first']);
  });

  it('respects the days window', async () => {
    const old = await ContextEntry.create({
      ts: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      text: 'old',
      related_persona: 'both',
      source: 'api',
    });
    await addContext({ text: 'new' });
    const last7 = await recentContext(7);
    expect(last7.map((e) => e.text)).toEqual(['new']);
    const last60 = await recentContext(60);
    expect(last60.map((e) => e.text).sort()).toEqual(['new', 'old']);
    expect(old._id).toBeDefined();
  });

  it('persona filter returns matching persona OR both', async () => {
    await addContext({ text: 'household-only', related_persona: 'household' });
    await addContext({ text: 'finance-only', related_persona: 'finance' });
    await addContext({ text: 'shared', related_persona: 'both' });

    const finance = await recentContext(7, 'finance');
    const texts = finance.map((e) => e.text).sort();
    expect(texts).toEqual(['finance-only', 'shared']);
  });

  it("explicit 'both' filter returns all entries", async () => {
    await addContext({ text: 'household-only', related_persona: 'household' });
    await addContext({ text: 'finance-only', related_persona: 'finance' });
    const all = await recentContext(7, 'both');
    expect(all.length).toBe(2);
  });
});

describe('todaysContext', () => {
  it('returns only entries from today', async () => {
    await ContextEntry.create({
      ts: new Date(Date.now() - 26 * 60 * 60 * 1000), // 26h ago
      text: 'yesterday',
      related_persona: 'both',
      source: 'api',
    });
    await addContext({ text: 'today' });
    const today = await todaysContext();
    expect(today.map((e) => e.text)).toEqual(['today']);
  });
});

describe('contextOnDate', () => {
  it('returns only entries within the local-day window', async () => {
    const today = new Date();
    const yKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    await ContextEntry.create({
      ts: new Date(today.getFullYear(), today.getMonth(), today.getDate() - 2),
      text: 'two days ago',
      related_persona: 'both',
      source: 'api',
    });
    await addContext({ text: 'today' });
    const list = await contextOnDate(yKey);
    expect(list.map((e) => e.text)).toEqual(['today']);
  });

  it('returns [] for a malformed date string', async () => {
    expect(await contextOnDate('not-a-date')).toEqual([]);
    expect(await contextOnDate('')).toEqual([]);
  });

  it('persona filter still applies in single-day mode', async () => {
    const today = new Date();
    const yKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    await addContext({ text: 'household-only', related_persona: 'household' });
    await addContext({ text: 'finance-only', related_persona: 'finance' });
    const finance = await contextOnDate(yKey, 'finance');
    expect(finance.map((e) => e.text).sort()).toEqual(['finance-only']);
  });
});
