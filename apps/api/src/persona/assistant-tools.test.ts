import { describe, it, expect } from 'vitest';
import {
  ASSISTANT_TOOLS,
  DEFERRED_TOOL_NAMES,
} from '@household-os/shared/persona/assistant';
import { assistantTools } from './assistant-tools.js';
import { Routine } from '../db/models/Routine.js';

/**
 * Drift detector + shape tests for the unified assistant. Mirrors the
 * existing per-persona tools.test.ts but against the single assistant tool
 * surface from §50 Phase A.
 */

describe('assistant tool surface (Phase A)', () => {
  it('every declared tool has a matching runtime impl', () => {
    const declared = new Set(ASSISTANT_TOOLS.map((t) => t.name));
    const implemented = new Set(Object.keys(assistantTools));
    const missing: string[] = [];
    for (const name of declared) {
      if (!implemented.has(name)) missing.push(name);
    }
    expect(missing).toEqual([]);
  });

  it('does not implement deferred tools (those are flagged for later phases)', () => {
    for (const name of DEFERRED_TOOL_NAMES) {
      expect(assistantTools[name]).toBeUndefined();
    }
  });

  it('every tool schema declares object type + a properties bag', () => {
    for (const t of ASSISTANT_TOOLS) {
      expect(t.input_schema.type).toBe('object');
      expect(typeof t.input_schema.properties).toBe('object');
      expect(t.description.length).toBeGreaterThan(20);
    }
  });
});

describe('assistantTools impls (smoke)', () => {
  it('list_routines returns active routines, honoring category filter', async () => {
    await Routine.create({
      key: 'lr_a',
      name: 'A',
      category: 'pet',
      zone: 'whole-house',
      scheduling: { type: 'rolling', interval_days: 7 },
      estimate_minutes: 10,
      energy: 'low',
      active: true,
    });
    await Routine.create({
      key: 'lr_b',
      name: 'B',
      category: 'cleaning',
      zone: 'kitchen',
      scheduling: { type: 'rolling', interval_days: 1 },
      estimate_minutes: 5,
      energy: 'low',
      active: true,
    });

    const all = (await assistantTools.list_routines!({})) as { key: string }[];
    expect(all.map((r) => r.key).sort()).toEqual(['lr_a', 'lr_b']);

    const onlyPet = (await assistantTools.list_routines!({ category: 'pet' })) as {
      key: string;
    }[];
    expect(onlyPet.map((r) => r.key)).toEqual(['lr_a']);
  });

  it('create_routine requires both key and name', async () => {
    await expect(
      assistantTools.create_routine!({ name: 'no key' }),
    ).rejects.toThrow(/key/);
    await expect(
      assistantTools.create_routine!({ key: 'no_name' }),
    ).rejects.toThrow(/name/);
  });

  it('create_routine fills sensible defaults', async () => {
    await assistantTools.create_routine!({
      key: 'cr_test',
      name: 'New routine',
      scheduling: { type: 'rolling', interval_days: 14 },
    });
    const doc = await Routine.findOne({ key: 'cr_test' }).lean();
    expect(doc).not.toBeNull();
    expect(doc?.category).toBe('personal');
    expect(doc?.zone).toBe('whole-house');
    expect(doc?.estimate_minutes).toBe(15);
    expect(doc?.energy).toBe('medium');
    expect(doc?.active).toBe(true);
  });

  it('delete_routine soft-deletes (sets active=false, keeps doc)', async () => {
    await Routine.create({
      key: 'dr_test',
      name: 'Dr test',
      category: 'personal',
      zone: 'whole-house',
      scheduling: { type: 'rolling', interval_days: 7 },
      estimate_minutes: 10,
      energy: 'low',
      active: true,
    });
    await assistantTools.delete_routine!({ key: 'dr_test' });
    const doc = await Routine.findOne({ key: 'dr_test' }).lean();
    expect(doc).not.toBeNull();
    expect(doc?.active).toBe(false);
  });

  it('add_rocketmoney_paste rejects empty text', async () => {
    await expect(
      assistantTools.add_rocketmoney_paste!({ text: '   ' }),
    ).rejects.toThrow(/text/);
  });

  it('estimate_tax returns the federal/FICA/state breakdown', async () => {
    const out = (await assistantTools.estimate_tax!({
      monthly_gross_income: 5000,
      state: 'WA',
      filing_status: 'single',
    })) as {
      federal: number;
      fica: number;
      state_tax: number;
      total: number;
      effective_rate: number;
    };
    expect(out.federal).toBeGreaterThan(0);
    expect(out.fica).toBeGreaterThan(0);
    expect(out.state_tax).toBe(0); // WA has no state income tax
    expect(out.total).toBeGreaterThan(0);
  });
});
