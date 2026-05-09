const BASE = process.env.HOUSEHOLD_API_BASE ?? 'http://localhost:3000/api';
const TOKEN = process.env.HOUSEHOLD_API_TOKEN ?? '';

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

export interface PlanItem {
  routine_key: string;
  name: string;
  estimate_minutes: number;
  energy: string;
  status: string;
}

export interface TodayPlan {
  date: string;
  current_energy: string;
  budget_minutes: number;
  items: PlanItem[];
  swap_pool: PlanItem[];
}

export interface EnergySuggestion {
  level: string;
  suggested_swaps_in: PlanItem[];
  suggested_swaps_out: PlanItem[];
  rationale: string;
}

export const apiClient = {
  getToday: () => request<TodayPlan>('/today'),
  swap: (item_key: string) =>
    request<TodayPlan>('/today/swap', {
      method: 'POST',
      body: JSON.stringify({ item_key }),
    }),
  markDone: (item_key: string) =>
    request<TodayPlan>('/today/mark-done', {
      method: 'POST',
      body: JSON.stringify({ item_key }),
    }),
  setEnergy: (level: string) =>
    request<EnergySuggestion>('/energy', {
      method: 'POST',
      body: JSON.stringify({ level, source: 'voice' }),
    }),
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
