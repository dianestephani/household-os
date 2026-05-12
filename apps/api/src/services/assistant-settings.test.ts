import { describe, it, expect } from 'vitest';
import {
  ASSISTANT_SYSTEM_PROMPT,
  ASSISTANT_MODEL,
} from '@household-os/shared/persona/assistant';
import { AssistantSettings } from '../db/models/AssistantSettings.js';
import {
  getCurrent,
  resetToSeed,
  update,
} from './assistant-settings.js';

describe('assistant-settings', () => {
  describe('getCurrent', () => {
    it('auto-seeds on first call with the shared assistant prompt', async () => {
      const before = await AssistantSettings.findOne({ key: 'current' }).lean();
      expect(before).toBeNull();

      const current = await getCurrent();
      expect(current.system_prompt).toBe(ASSISTANT_SYSTEM_PROMPT);
      expect(current.model).toBe(ASSISTANT_MODEL);
      expect(current.versions).toHaveLength(1);
      expect(current.versions[0]?.edited_by).toBe('seed');

      const after = await AssistantSettings.findOne({ key: 'current' }).lean();
      expect(after).not.toBeNull();
      expect(after?.system_prompt).toBe(ASSISTANT_SYSTEM_PROMPT);
    });

    it('returns the same singleton on repeat calls (does not duplicate)', async () => {
      const first = await getCurrent();
      const second = await getCurrent();
      expect(first.system_prompt).toBe(second.system_prompt);

      const count = await AssistantSettings.countDocuments({ key: 'current' });
      expect(count).toBe(1);
      // No additional versions added on a simple read.
      expect(second.versions).toHaveLength(1);
    });
  });

  describe('update', () => {
    it('replaces the live prompt and pushes a new version', async () => {
      await getCurrent();
      const updated = await update('You are a tighter assistant. Be brief.');

      expect(updated.system_prompt).toBe('You are a tighter assistant. Be brief.');
      expect(updated.versions).toHaveLength(2);
      expect(updated.versions[0]?.edited_by).toBe('seed');
      expect(updated.versions[1]?.edited_by).toBe('user');
      expect(updated.versions[1]?.system_prompt).toBe(
        'You are a tighter assistant. Be brief.',
      );
    });

    it('trims whitespace before saving', async () => {
      const updated = await update('   hello world   ');
      expect(updated.system_prompt).toBe('hello world');
    });

    it('rejects empty / whitespace-only prompts', async () => {
      await expect(update('')).rejects.toThrow(/empty/i);
      await expect(update('   ')).rejects.toThrow(/empty/i);
    });

    it('preserves prior versions across multiple edits', async () => {
      await getCurrent();
      await update('v1');
      await update('v2');
      const final = await update('v3');

      expect(final.system_prompt).toBe('v3');
      expect(final.versions).toHaveLength(4); // seed + v1 + v2 + v3
      expect(final.versions.map((v) => v.system_prompt)).toEqual([
        ASSISTANT_SYSTEM_PROMPT,
        'v1',
        'v2',
        'v3',
      ]);
    });
  });

  describe('resetToSeed', () => {
    it('restores the seed prompt and records a seed-edit version', async () => {
      await update('something custom');
      const reset = await resetToSeed();

      expect(reset.system_prompt).toBe(ASSISTANT_SYSTEM_PROMPT);
      // seed (auto) + custom + reset = 3
      expect(reset.versions).toHaveLength(3);
      expect(reset.versions[reset.versions.length - 1]?.edited_by).toBe('seed');
    });
  });
});
