import { Routine } from '../db/models/Routine.js';

export async function listRoutines(filter: { category?: string; zone?: string } = {}) {
  const q: Record<string, unknown> = { active: true };
  if (filter.category) q.category = filter.category;
  if (filter.zone) q.zone = filter.zone;
  return Routine.find(q).lean();
}

export async function getRoutine(key: string) {
  return Routine.findOne({ key }).lean();
}

export async function patchRoutine(key: string, patch: Record<string, unknown>) {
  const allowed = [
    'name',
    'category',
    'zone',
    'scheduling',
    'estimate_minutes',
    'energy',
    'skip_if',
    'also_triggers',
    'last_done',
    'active',
  ];
  const safe: Record<string, unknown> = {};
  for (const k of allowed) {
    if (k in patch) safe[k] = patch[k];
  }
  await Routine.updateOne({ key }, { $set: safe });
  return Routine.findOne({ key }).lean();
}

export async function createRoutine(doc: Record<string, unknown>) {
  return Routine.create(doc);
}

export async function softDeleteRoutine(key: string) {
  await Routine.updateOne({ key }, { $set: { active: false } });
  return { key, active: false };
}
