import { AdHocTask } from '../db/models/AdHocTask.js';
import { ZoneAssessment } from '../db/models/ZoneAssessment.js';
import { logActivity } from './activity.js';
import type {
  AdHocTask as AdHocTaskType,
  EnergyLevel,
  Zone,
  ZoneAssessment as ZoneAssessmentType,
  ZoneStateLevel,
} from '@household-os/shared/types';

export const ZONES: Zone[] = [
  'kitchen',
  'bathrooms',
  'common',
  'bedroom',
  'yard',
  'whole-house',
];

const ESTIMATE_BY_SEVERITY: Record<ZoneStateLevel, number> = {
  fine: 0,
  meh: 15,
  rough: 25,
};

const ENERGY_BY_SEVERITY: Record<ZoneStateLevel, EnergyLevel> = {
  fine: 'low',
  meh: 'medium',
  rough: 'high',
};

const ZONE_LABEL: Record<Zone, string> = {
  kitchen: 'kitchen',
  bathrooms: 'bathrooms',
  common: 'common areas',
  bedroom: 'bedroom',
  yard: 'yard',
  'whole-house': 'whole house',
  // 'self' is for beauty routines; zone assessments don't apply there, but the
  // map has to be exhaustive over the Zone union.
  self: 'self-care',
};

function defaultTaskName(zone: Zone, severity: ZoneStateLevel): string {
  const verb = severity === 'rough' ? 'Address' : 'Tend to';
  return `${verb} ${ZONE_LABEL[zone]}`;
}

/**
 * Pick the zone least-recently assessed. Zones never assessed sort first.
 * Used by the morning rotation to step through zones gently.
 */
export async function pickNextZone(): Promise<Zone> {
  const recent = await ZoneAssessment.aggregate<{
    _id: string;
    last_ts: Date;
  }>([
    {
      $group: {
        _id: '$zone',
        last_ts: { $max: '$ts' },
      },
    },
  ]);
  const lastByZone = new Map(recent.map((r) => [r._id as Zone, r.last_ts]));

  return ZONES.slice().sort((a, b) => {
    const ta = lastByZone.get(a)?.getTime() ?? 0;
    const tb = lastByZone.get(b)?.getTime() ?? 0;
    return ta - tb;
  })[0]!;
}

export async function recordAssessment(
  zone: Zone,
  level: ZoneStateLevel,
  notes: string | undefined,
  source_checkin_id?: string,
): Promise<{ assessment: ZoneAssessmentType; task: AdHocTaskType | null }> {
  const assessment = await ZoneAssessment.create({
    ts: new Date(),
    zone,
    level,
    notes,
    source_checkin_id,
  });

  await logActivity('zone_assessed', `Zone ${zone}: ${level}`, {
    metadata: { zone, level, notes },
  });

  if (level === 'fine') {
    return {
      assessment: assessment.toObject() as unknown as ZoneAssessmentType,
      task: null,
    };
  }

  const trimmed = (notes ?? '').trim();
  const taskName = trimmed.length > 0 ? trimmed : defaultTaskName(zone, level);

  const task = await AdHocTask.create({
    ts: new Date(),
    zone,
    name: taskName,
    source: 'zone_assessment',
    source_assessment_id: assessment.id,
    severity: level,
    estimate_minutes: ESTIMATE_BY_SEVERITY[level],
    energy: ENERGY_BY_SEVERITY[level],
    status: 'open',
  });

  await logActivity('task_created', `Task added: "${taskName}"`, {
    actor: 'system',
    metadata: { zone, severity: level, source: 'zone_assessment' },
  });

  return {
    assessment: assessment.toObject() as unknown as ZoneAssessmentType,
    task: task.toObject() as unknown as AdHocTaskType,
  };
}

export async function listOpenAdHocTasks() {
  return AdHocTask.find({ status: 'open' }).sort({ ts: 1 }).lean();
}

export async function listRecentAssessments(days = 14) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return ZoneAssessment.find({ ts: { $gte: since } })
    .sort({ ts: -1 })
    .lean();
}

/**
 * Latest assessment per zone — convenient for the persona / dashboard.
 */
export async function latestAssessmentByZone(): Promise<
  Partial<Record<Zone, ZoneAssessmentType>>
> {
  const all = await ZoneAssessment.find({}).sort({ ts: -1 }).lean();
  const result: Partial<Record<Zone, ZoneAssessmentType>> = {};
  for (const a of all) {
    const z = a.zone as Zone;
    if (!result[z]) result[z] = a as unknown as ZoneAssessmentType;
  }
  return result;
}

export async function cancelAdHocTask(id: string) {
  const before = await AdHocTask.findById(id).lean();
  await AdHocTask.updateOne(
    { _id: id },
    { $set: { status: 'cancelled' } },
  );
  if (before) {
    await logActivity('task_cancelled', `Cancelled task: "${before.name}"`, {
      metadata: { task_id: id, zone: before.zone },
    });
  }
  return AdHocTask.findById(id).lean();
}

export async function markAdHocTaskDone(id: string) {
  await AdHocTask.updateOne(
    { _id: id },
    { $set: { status: 'done', done_at: new Date() } },
  );
  return AdHocTask.findById(id).lean();
}

/**
 * Resolve an `adhoc_<id>` plan-item key back to its AdHocTask. Used by markDone
 * to route between Routine and AdHocTask completion.
 */
export const ADHOC_PREFIX = 'adhoc_';
export function isAdHocKey(key: string): boolean {
  return key.startsWith(ADHOC_PREFIX);
}
export function adHocKeyFor(id: string): string {
  return ADHOC_PREFIX + id;
}
export function idFromAdHocKey(key: string): string {
  return key.slice(ADHOC_PREFIX.length);
}
