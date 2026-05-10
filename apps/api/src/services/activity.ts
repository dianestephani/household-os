import { ActivityLog } from '../db/models/ActivityLog.js';
import type {
  ActivityActor,
  ActivityKind,
} from '@household-os/shared/types';

/**
 * Append a single event to the unified activity timeline. Errors are logged
 * but not re-thrown — activity logging is observational and must never break
 * the action it's recording.
 */
export async function logActivity(
  kind: ActivityKind,
  summary: string,
  options: {
    actor?: ActivityActor;
    metadata?: Record<string, unknown>;
  } = {},
): Promise<void> {
  try {
    await ActivityLog.create({
      ts: new Date(),
      kind,
      summary,
      actor: options.actor ?? 'user',
      metadata: options.metadata,
    });
  } catch (err) {
    console.error('[activity] log failed', err);
  }
}

export async function recentActivity(days = 14, kind?: ActivityKind) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const q: Record<string, unknown> = { ts: { $gte: since } };
  if (kind) q.kind = kind;
  return ActivityLog.find(q).sort({ ts: -1 }).limit(500).lean();
}

/**
 * Activity entries that occurred during the local-midnight window of a given
 * YYYY-MM-DD date. Powers the "what did I do on this day" view in the
 * dashboard's day-navigated activity feed.
 */
export async function activityOnDate(dateStr: string, kind?: ActivityKind) {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return [];
  const start = new Date(y, m - 1, d);
  const end = new Date(y, m - 1, d + 1);
  const q: Record<string, unknown> = { ts: { $gte: start, $lt: end } };
  if (kind) q.kind = kind;
  return ActivityLog.find(q).sort({ ts: -1 }).limit(500).lean();
}
