import { ContextEntry } from '../db/models/ContextEntry.js';
import { logActivity } from './activity.js';
import type {
  ContextEntry as ContextEntryType,
  ContextEntryInput,
  ContextRelatedPersona,
} from '@household-os/shared/types';

/**
 * Append a narrative journal entry. Both Diane (via dashboard/voice) and the
 * personas (via tool call) write here. Free-form `text` is required; structured
 * fields are optional but make patterns queryable later.
 */
export async function addContext(
  input: ContextEntryInput,
): Promise<ContextEntryType> {
  const text = (input.text ?? '').trim();
  if (!text) {
    throw new Error('context entry text is required');
  }

  const doc = await ContextEntry.create({
    ts: new Date(),
    text,
    tags: input.tags && input.tags.length > 0 ? input.tags : undefined,
    energy: input.energy,
    mood: input.mood,
    dogsit_count: input.dogsit_count,
    blocked_activities:
      input.blocked_activities && input.blocked_activities.length > 0
        ? input.blocked_activities
        : undefined,
    related_persona: input.related_persona ?? 'both',
    source: input.source ?? 'api',
  });

  await logActivity('context_logged', summarize(text), {
    actor: input.source === 'persona' ? 'system' : 'user',
    metadata: {
      related_persona: doc.related_persona,
      tags: doc.tags,
      energy: doc.energy,
      mood: doc.mood,
      dogsit_count: doc.dogsit_count,
      blocked_activities: doc.blocked_activities,
      source: doc.source,
    },
  });

  return doc.toObject() as unknown as ContextEntryType;
}

/**
 * Recent entries, newest first. Optional `persona` filter returns entries
 * tagged for that persona OR `both`. Defaults: 7 days, no persona filter.
 */
export async function recentContext(
  days = 7,
  persona?: ContextRelatedPersona,
): Promise<ContextEntryType[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const q: Record<string, unknown> = { ts: { $gte: since } };
  if (persona && persona !== 'both') {
    q.related_persona = { $in: [persona, 'both'] };
  }
  const docs = await ContextEntry.find(q)
    .sort({ ts: -1 })
    .limit(200)
    .lean();
  return docs as unknown as ContextEntryType[];
}

/**
 * Entries from the start of the local day (treat ts >= midnight today).
 * Used by the today plan to surface inline context.
 */
export async function todaysContext(
  persona?: ContextRelatedPersona,
): Promise<ContextEntryType[]> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const q: Record<string, unknown> = { ts: { $gte: start } };
  if (persona && persona !== 'both') {
    q.related_persona = { $in: [persona, 'both'] };
  }
  const docs = await ContextEntry.find(q).sort({ ts: -1 }).lean();
  return docs as unknown as ContextEntryType[];
}

function summarize(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length <= 80 ? `Logged context: "${oneLine}"` : `Logged context: "${oneLine.slice(0, 77)}…"`;
}
