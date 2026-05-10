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
  ContextEntry,
  ContextEntryInput,
  ContextRelatedPersona,
  FilingStatus,
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

const TOKEN = import.meta.env.VITE_API_TOKEN ?? '';
const BASE = import.meta.env.VITE_API_BASE ?? '/api';

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
      request<unknown>('/mood', {
        method: 'POST',
        body: JSON.stringify({ level, source: 'dashboard' }),
      }),
  },
  workouts: {
    today: () =>
      request<{
        slot: { slot_key: WorkoutSlotKey; name: string; type: string } | null;
        log: WorkoutLog | null;
      }>('/workouts/today'),
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
  },
  context: {
    list: (days = 7, persona?: ContextRelatedPersona) => {
      const qs = new URLSearchParams({ days: String(days) });
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
