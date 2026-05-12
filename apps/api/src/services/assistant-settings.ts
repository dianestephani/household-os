import { AssistantSettings } from '../db/models/AssistantSettings.js';
import {
  ASSISTANT_SYSTEM_PROMPT,
  ASSISTANT_MODEL,
} from '@household-os/shared/persona/assistant';

/**
 * Singleton service for the unified assistant's live system prompt. Auto-
 * seeds from the constant in `@household-os/shared/persona/assistant` on
 * first read. Phase A — see HANDOFF §50.
 */

export interface AssistantSettingsView {
  system_prompt: string;
  model: string;
  versions: { ts: Date; system_prompt: string; edited_by: 'user' | 'seed' }[];
  updated_at: Date;
}

function toView(doc: {
  system_prompt: string;
  model?: string;
  versions?: { ts?: Date; system_prompt: string; edited_by?: 'user' | 'seed' }[];
  updated_at?: Date;
}): AssistantSettingsView {
  return {
    system_prompt: doc.system_prompt,
    model: doc.model ?? ASSISTANT_MODEL,
    versions: (doc.versions ?? []).map((v) => ({
      ts: v.ts ?? new Date(0),
      system_prompt: v.system_prompt,
      edited_by: v.edited_by ?? 'user',
    })),
    updated_at: doc.updated_at ?? new Date(),
  };
}

/**
 * Returns the live settings, auto-seeding the document on first call. The
 * first version entry is the seed itself so rollback always has a target.
 */
export async function getCurrent(): Promise<AssistantSettingsView> {
  const existing = await AssistantSettings.findOne({ key: 'current' }).lean();
  if (existing) return toView(existing);

  const now = new Date();
  await AssistantSettings.create({
    key: 'current',
    system_prompt: ASSISTANT_SYSTEM_PROMPT,
    model: ASSISTANT_MODEL,
    versions: [
      { ts: now, system_prompt: ASSISTANT_SYSTEM_PROMPT, edited_by: 'seed' },
    ],
    updated_at: now,
  });
  const created = await AssistantSettings.findOne({ key: 'current' }).lean();
  return toView(created!);
}

/**
 * Updates the live system prompt. Pushes the previous value into `versions`
 * before overwriting so rollback works. Empty/whitespace-only prompts are
 * rejected — the model would silently behave badly with no system prompt.
 */
export async function update(systemPrompt: string): Promise<AssistantSettingsView> {
  const trimmed = (systemPrompt ?? '').trim();
  if (!trimmed) {
    throw new Error('system_prompt cannot be empty');
  }

  // Make sure a record exists so we can record the prior version.
  await getCurrent();

  const now = new Date();
  await AssistantSettings.updateOne(
    { key: 'current' },
    {
      $set: { system_prompt: trimmed, updated_at: now },
      $push: {
        versions: { ts: now, system_prompt: trimmed, edited_by: 'user' },
      },
    },
  );

  const updated = await AssistantSettings.findOne({ key: 'current' }).lean();
  return toView(updated!);
}

/**
 * Restores the seed prompt from `@household-os/shared/persona/assistant`.
 * Records a `seed` version entry on the way back so the history reflects the
 * reset.
 */
export async function resetToSeed(): Promise<AssistantSettingsView> {
  await getCurrent();

  const now = new Date();
  await AssistantSettings.updateOne(
    { key: 'current' },
    {
      $set: { system_prompt: ASSISTANT_SYSTEM_PROMPT, updated_at: now },
      $push: {
        versions: {
          ts: now,
          system_prompt: ASSISTANT_SYSTEM_PROMPT,
          edited_by: 'seed',
        },
      },
    },
  );

  const updated = await AssistantSettings.findOne({ key: 'current' }).lean();
  return toView(updated!);
}
