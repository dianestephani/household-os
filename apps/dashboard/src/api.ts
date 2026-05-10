import type {
  Routine,
  TodayPlan,
  Trigger,
  EnergyLevel,
  EnergySuggestion,
  MoodLevel,
  DeferReasonCode,
  DeferralPattern,
  WorkoutLog,
  WorkoutPattern,
  WorkoutSlotKey,
  WorkoutStatus,
  CheckIn,
  ActivityKind,
  ActivityLogEntry,
  CalendarDayResponse,
  CalendarTask,
  ContextEntry,
  ContextEntryInput,
  ContextRelatedPersona,
  DayView,
  FilingStatus,
  MoodLog,
  ScheduleRangeResponse,
  FinancialProfile,
  OutsourceableSummary,
  TaxEstimate,
} from '@household-os/shared/types';

export interface AffordabilityReport {
  profile: FinancialProfile;
  discretionary_monthly: number;
  outsourceable: OutsourceableSummary;
  fits_within_discretionary: OutsourceableSummary['items'];
  exceeds_discretionary: OutsourceableSummary['items'];
  rationale: string;
}

const LEGACY_TOKEN = import.meta.env.VITE_API_TOKEN ?? '';
const BASE = import.meta.env.VITE_API_BASE ?? '/api';

/**
 * Resolve the current bearer for an outgoing API request. Session token
 * (Google sign-in flow) takes precedence; falls back to the legacy build-time
 * VITE_API_TOKEN for envs that haven't set up sign-in.
 */
function currentToken(): string {
  try {
    const session = localStorage.getItem('household-os.session');
    if (session) return session;
  } catch {
    /* localStorage unavailable */
  }
  return LEGACY_TOKEN;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...((init.headers as Record<string, string>) ?? {}),
  };
  const token = currentToken();
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

export const api = {
  today: {
    get: () => request<TodayPlan>('/today'),
    regenerate: () =>
      request<TodayPlan>('/today/regenerate', { method: 'POST' }),
    swap: (
      item_key: string,
      replacement_key?: string,
      reason?: DeferReasonCode,
      notes?: string,
    ) =>
      request<TodayPlan>('/today/swap', {
        method: 'POST',
        body: JSON.stringify({ item_key, replacement_key, reason, notes }),
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
  },
  energy: {
    set: (level: EnergyLevel) =>
      request<EnergySuggestion>('/energy', {
        method: 'POST',
        body: JSON.stringify({ level, source: 'dashboard' }),
      }),
  },
  routines: {
    list: () => request<Routine[]>('/routines'),
    patch: (key: string, patch: Partial<Routine>) =>
      request<Routine>(`/routines/${key}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
  },
  triggers: {
    list: () => request<Trigger[]>('/triggers'),
  },
  mood: {
    set: (level: MoodLevel) =>
      request<MoodLog>('/mood', {
        method: 'POST',
        body: JSON.stringify({ level, source: 'dashboard' }),
      }),
    recent: (days = 14) => request<MoodLog[]>(`/mood?days=${days}`),
  },
  workouts: {
    today: () =>
      request<{
        slot: { slot_key: WorkoutSlotKey; name: string; type: string } | null;
        log: WorkoutLog | null;
      }>('/workouts/today'),
    byDate: (date: string) =>
      request<{
        slot: { slot_key: WorkoutSlotKey; name: string; type: string } | null;
        log: WorkoutLog | null;
      }>(`/workouts/by-date/${date}`),
    list: (days = 14) => request<WorkoutLog[]>(`/workouts?days=${days}`),
    log: (input: {
      slot_key: WorkoutSlotKey;
      status: WorkoutStatus;
      notes?: string;
    }) =>
      request<WorkoutLog>('/workouts', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
  },
  patterns: {
    deferrals: (days = 14, min = 2) =>
      request<DeferralPattern[]>(`/patterns/deferrals?days=${days}&min=${min}`),
    workouts: (days = 14) =>
      request<WorkoutPattern>(`/patterns/workouts?days=${days}`),
  },
  checkins: {
    pending: () => request<CheckIn[]>('/checkins/pending'),
    answer: (id: string, answers: Record<string, string>) =>
      request<CheckIn>(`/checkins/${id}/answer`, {
        method: 'POST',
        body: JSON.stringify({ answers }),
      }),
    skip: (id: string) =>
      request<CheckIn>(`/checkins/${id}/skip`, { method: 'POST' }),
  },
  activity: {
    list: (days = 7, kind?: ActivityKind) => {
      const qs = new URLSearchParams({ days: String(days) });
      if (kind) qs.set('kind', kind);
      return request<ActivityLogEntry[]>(`/activity?${qs.toString()}`);
    },
    onDate: (date: string, kind?: ActivityKind) => {
      const qs = new URLSearchParams({ date });
      if (kind) qs.set('kind', kind);
      return request<ActivityLogEntry[]>(`/activity?${qs.toString()}`);
    },
  },
  calendar: {
    today: () => request<CalendarDayResponse>('/calendar/today'),
  },
  schedule: {
    range: (days = 7) =>
      request<ScheduleRangeResponse>(`/schedule?days=${days}`),
  },
  day: {
    get: (date: string) => request<DayView>(`/day/${date}`),
  },
  tasks: {
    forDay: (date: string) =>
      request<CalendarTask[]>(`/tasks?date=${date}`),
    backlog: () => request<CalendarTask[]>('/tasks/backlog'),
    complete: (tasklist_id: string, task_id: string) =>
      request<CalendarTask>('/tasks/complete', {
        method: 'POST',
        body: JSON.stringify({ tasklist_id, task_id }),
      }),
    uncomplete: (tasklist_id: string, task_id: string) =>
      request<CalendarTask>('/tasks/uncomplete', {
        method: 'POST',
        body: JSON.stringify({ tasklist_id, task_id }),
      }),
  },
  context: {
    list: (days = 7, persona?: ContextRelatedPersona) => {
      const qs = new URLSearchParams({ days: String(days) });
      if (persona) qs.set('persona', persona);
      return request<ContextEntry[]>(`/context?${qs.toString()}`);
    },
    onDate: (date: string, persona?: ContextRelatedPersona) => {
      const qs = new URLSearchParams({ date });
      if (persona) qs.set('persona', persona);
      return request<ContextEntry[]>(`/context?${qs.toString()}`);
    },
    today: (persona?: ContextRelatedPersona) => {
      const qs = new URLSearchParams();
      if (persona) qs.set('persona', persona);
      const suffix = qs.toString() ? `?${qs.toString()}` : '';
      return request<ContextEntry[]>(`/context/today${suffix}`);
    },
    add: (entry: ContextEntryInput) =>
      request<ContextEntry>('/context', {
        method: 'POST',
        body: JSON.stringify({ ...entry, source: entry.source ?? 'dashboard' }),
      }),
  },
  finance: {
    profile: () => request<FinancialProfile>('/finance/profile'),
    setProfile: (patch: Partial<FinancialProfile>) =>
      request<FinancialProfile>('/finance/profile', {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    outsourceable: () => request<OutsourceableSummary>('/finance/outsourceable'),
    affordability: () => request<AffordabilityReport>('/finance/affordability'),
    estimateTax: (input: {
      monthly_gross_income: number;
      state?: string;
      filing_status?: FilingStatus;
      monthly_extra_withholding?: number;
    }) =>
      request<TaxEstimate>('/finance/estimate-tax', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
  },
  chat: (
    persona: string,
    messages: { role: 'user' | 'assistant'; content: string }[],
  ) =>
    request<{ reply: string; messages: { role: string; content: string }[] }>(
      `/chat/${persona}`,
      { method: 'POST', body: JSON.stringify({ messages }) },
    ),
};
