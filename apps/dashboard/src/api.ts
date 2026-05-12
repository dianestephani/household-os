import type {
  Routine,
  WorkoutLog,
  WorkoutSlotKey,
  WorkoutStatus,
  AwakenessLevel,
  CalendarDayResponse,
  EnergyLevel,
  FilingStatus,
  FinancialProfileSnapshot,
  ImportKind,
  MoodLevel,
  MorningCheckin,
  RocketMoneyImport,
  FinancialProfile,
  OutsourceableSummary,
  TaxEstimate,
} from '@household-os/shared/types';

/** Response shape for GET /api/assistant-settings (§50 Phase A). */
export interface AssistantSettingsView {
  system_prompt: string;
  model: string;
  versions: { ts: string; system_prompt: string; edited_by: 'user' | 'seed' }[];
  updated_at: string;
}

/** Response shape for POST /api/chat (§50 Phase A). */
export interface ChatResult {
  text: string;
  blocks: unknown[];
  tool_rounds: number;
  usage?: Record<string, number | undefined>;
  live: boolean;
}

export type ChatMessage = {
  role: 'user' | 'assistant';
  content: string | unknown;
};

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

/**
 * §50 Phase C — surviving REST surface. Endpoints retired in Phase C:
 *   /api/today/*, /api/zones/*, /api/checkins/*, /api/patterns/*, /api/mood,
 *   /api/energy, /api/context, /api/day/*, /api/schedule, /api/meal-weeks/*,
 *   /api/tasks, /api/activity (was used by Log + FinanceDayLog), /mcp.
 *
 * Surviving + new:
 *   /api/routines, /api/finance/*, /api/calendar/today,
 *   /api/morning-checkin/*, /api/chat, /api/assistant-settings, /api/triggers,
 *   /api/appointments/*, /api/workouts/*, /api/alexa/shopping-list (kept per
 *   §50 hard-rule but not in active dashboard use), /api/auth/google.
 */
export const api = {
  morningCheckin: {
    get: (date?: string) =>
      request<MorningCheckin | null>(
        date ? `/morning-checkin/${date}` : '/morning-checkin',
      ),
    recent: (days = 14) =>
      request<MorningCheckin[]>(`/morning-checkin?days=${days}`),
    save: (input: {
      date?: string;
      mood: MoodLevel;
      energy: EnergyLevel;
      awakeness: AwakenessLevel;
      note?: string;
    }) =>
      request<MorningCheckin>('/morning-checkin', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
  },
  chat: {
    send: (messages: ChatMessage[]) =>
      request<ChatResult>('/chat', {
        method: 'POST',
        body: JSON.stringify({ messages }),
      }),
  },
  assistantSettings: {
    get: () => request<AssistantSettingsView>('/assistant-settings'),
    update: (systemPrompt: string) =>
      request<AssistantSettingsView>('/assistant-settings', {
        method: 'PATCH',
        body: JSON.stringify({ system_prompt: systemPrompt }),
      }),
    reset: () =>
      request<AssistantSettingsView>('/assistant-settings/reset', {
        method: 'POST',
      }),
  },
  calendar: {
    today: () => request<CalendarDayResponse>('/calendar/today'),
  },
  routines: {
    list: () => request<Routine[]>('/routines'),
    patch: (key: string, patch: Partial<Routine>) =>
      request<Routine>(`/routines/${key}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
  },
  appointments: {
    create: (
      routineKey: string,
      startsAt: string,
      durationMinutes?: number,
    ) =>
      request<{
        routine: Routine;
        calendar_event_id: string | null;
        starts_at: string;
        duration_minutes: number;
        calendar_skipped: boolean;
      }>(`/appointments/${routineKey}`, {
        method: 'POST',
        body: JSON.stringify({
          starts_at: startsAt,
          duration_minutes: durationMinutes,
        }),
      }),
    reconcile: (routineKey: string) =>
      request<{
        routine_key: string;
        action: 'no_change' | 'rescheduled' | 'deleted' | 'past_completed';
        applied: boolean;
      }>(`/appointments/${routineKey}/reconcile`, { method: 'POST' }),
    unlink: (routineKey: string) =>
      request<Routine>(`/appointments/${routineKey}`, { method: 'DELETE' }),
  },
  workouts: {
    /** Retroactive workout log — Look Back's only mutator. */
    log: (input: {
      slot_key: WorkoutSlotKey;
      status: WorkoutStatus;
      notes?: string;
    }) =>
      request<WorkoutLog>('/workouts', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    list: (days = 14) => request<WorkoutLog[]>(`/workouts?days=${days}`),
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
    imports: {
      list: (limit = 50) =>
        request<RocketMoneyImport[]>(`/finance/imports?limit=${limit}`),
      create: (input: { kind: ImportKind; raw: string; filename?: string }) =>
        request<RocketMoneyImport>('/finance/imports', {
          method: 'POST',
          body: JSON.stringify(input),
        }),
      apply: (importId: string) =>
        request<{
          profile: FinancialProfile;
          snapshot_id: string;
          import_id: string;
        }>(`/finance/imports/${importId}/apply`, { method: 'POST' }),
    },
    snapshots: {
      list: (limit = 50) =>
        request<FinancialProfileSnapshot[]>(
          `/finance/snapshots?limit=${limit}`,
        ),
      restore: (snapshotId: string) =>
        request<FinancialProfile>(
          `/finance/snapshots/${snapshotId}/restore`,
          { method: 'POST' },
        ),
    },
  },
};
