/**
 * Where the skill's HTTP calls land. The skill is mounted on the same Express
 * server as the API (see apps/api/src/index.ts), so the safe default is
 * "loopback to whatever port this process bound to" — that works for both
 * localhost dev (PORT unset → 3000) and Render (PORT assigned dynamically).
 * Override via env if the skill is ever deployed separately from the API.
 */
const BASE =
  process.env.HOUSEHOLD_API_BASE ??
  `http://localhost:${process.env.PORT ?? '3000'}/api`;

/**
 * Bearer token for the API. Falls back to API_TOKEN so a single env var
 * configures both the API and the in-process skill client.
 */
const TOKEN =
  process.env.HOUSEHOLD_API_TOKEN ?? process.env.API_TOKEN ?? '';

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...((init.headers as Record<string, string>) ?? {}),
  };
  if (TOKEN) headers.authorization = `Bearer ${TOKEN}`;
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

export type EnergyLevel = 'low' | 'medium' | 'high';
export type MoodLevel = 'good' | 'neutral' | 'down';
export type ZoneLevel = 'fine' | 'meh' | 'rough';
export type WorkoutStatus = 'done' | 'skipped' | 'partial';
export type WorkoutSlot = 'pt_tue' | 'pt_thu' | 'lift_flex' | 'ad_hoc';
export type Zone =
  | 'kitchen'
  | 'bathrooms'
  | 'common'
  | 'bedroom'
  | 'yard'
  | 'whole-house';
export type DeferReason =
  | 'tired'
  | 'not_in_mood'
  | 'out_of_time'
  | 'manual_swap'
  | 'other';

export interface PlanItem {
  routine_key: string;
  name: string;
  estimate_minutes: number;
  energy: EnergyLevel;
  status: string;
}

export interface TodayPlan {
  date: string;
  current_energy: EnergyLevel;
  budget_minutes: number;
  items: PlanItem[];
  swap_pool: PlanItem[];
}

export interface EnergySuggestion {
  level: EnergyLevel;
  suggested_swaps_in: PlanItem[];
  suggested_swaps_out: PlanItem[];
  rationale: string;
}

export interface CheckInQuestion {
  id: string;
  text: string;
  type: 'text' | 'choice' | 'mood' | 'energy';
  answer?: string;
}

export interface CheckIn {
  _id: string;
  type: 'morning_intent' | 'evening_retro' | 'weekly_review' | 'pattern_interrupt' | 'zone_assessment';
  scheduled_for: string;
  status: 'pending' | 'answered' | 'skipped' | 'expired';
  questions: CheckInQuestion[];
}

export interface WorkoutSlotInfo {
  slot_key: WorkoutSlot;
  name: string;
  type: string;
}

export interface DeferralPattern {
  routine_key: string;
  routine_name: string;
  count: number;
  window_days: number;
}

export interface ActivityEntry {
  _id: string;
  ts: string;
  kind: string;
  summary: string;
  actor: 'user' | 'system' | 'cron';
}

export const apiClient = {
  // ----- today -----
  getToday: () => request<TodayPlan>('/today'),
  swap: (item_key: string, reason?: DeferReason) =>
    request<TodayPlan>('/today/swap', {
      method: 'POST',
      body: JSON.stringify({ item_key, reason }),
    }),
  markDone: (item_key: string) =>
    request<TodayPlan>('/today/mark-done', {
      method: 'POST',
      body: JSON.stringify({ item_key }),
    }),
  pullFromPool: (item_key: string) =>
    request<TodayPlan>('/today/pull-from-pool', {
      method: 'POST',
      body: JSON.stringify({ item_key }),
    }),

  // ----- wellbeing -----
  setEnergy: (level: EnergyLevel) =>
    request<EnergySuggestion>('/energy', {
      method: 'POST',
      body: JSON.stringify({ level, source: 'voice' }),
    }),
  setMood: (level: MoodLevel) =>
    request('/mood', {
      method: 'POST',
      body: JSON.stringify({ level, source: 'voice' }),
    }),

  // ----- workouts -----
  todaysWorkout: () =>
    request<{ slot: WorkoutSlotInfo | null; log: { status: WorkoutStatus } | null }>(
      '/workouts/today',
    ),
  logWorkout: (slot_key: WorkoutSlot, status: WorkoutStatus) =>
    request('/workouts', {
      method: 'POST',
      body: JSON.stringify({ slot_key, status }),
    }),

  // ----- zones -----
  assessZone: (zone: Zone, level: ZoneLevel, notes?: string) =>
    request('/zones/assess', {
      method: 'POST',
      body: JSON.stringify({ zone, level, notes }),
    }),

  // ----- check-ins -----
  pendingCheckIns: () => request<CheckIn[]>('/checkins/pending'),
  answerCheckIn: (id: string, answers: Record<string, string>) =>
    request<CheckIn>(`/checkins/${id}/answer`, {
      method: 'POST',
      body: JSON.stringify({ answers }),
    }),
  skipCheckIn: (id: string) =>
    request<CheckIn>(`/checkins/${id}/skip`, { method: 'POST' }),

  // ----- patterns -----
  frequentDeferrals: (days = 14, min = 2) =>
    request<DeferralPattern[]>(`/patterns/deferrals?days=${days}&min=${min}`),
  workoutSummary: (days = 14) =>
    request<{ done: number; skipped: number; partial: number; scheduled: number }>(
      `/patterns/workouts?days=${days}`,
    ),

  // ----- activity -----
  recentActivity: (days = 1) =>
    request<ActivityEntry[]>(`/activity?days=${days}`),

  // ----- chat (free-form) -----
  chat: (persona: string, content: string) =>
    request<{ reply: string }>(`/chat/${persona}`, {
      method: 'POST',
      body: JSON.stringify({ messages: [{ role: 'user', content }] }),
    }),
};

/** Best-effort fuzzy match of a slot phrase to a plan item by name. */
export function fuzzyMatch(items: PlanItem[], phrase: string): PlanItem | null {
  if (!phrase) return null;
  const p = phrase.toLowerCase().trim();
  const exact = items.find((it) => it.name.toLowerCase() === p);
  if (exact) return exact;
  const partial = items.find(
    (it) =>
      it.name.toLowerCase().includes(p) || p.includes(it.name.toLowerCase()),
  );
  return partial ?? null;
}

/**
 * Normalize an ISO timestamp to a friendly relative string for voice ("3 hours
 * ago"). Used by activity-log responses.
 */
export function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
  const day = Math.round(hr / 24);
  return `${day} day${day === 1 ? '' : 's'} ago`;
}
