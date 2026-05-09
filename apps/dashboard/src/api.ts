import type {
  Routine,
  TodayPlan,
  Trigger,
  EnergyLevel,
  EnergySuggestion,
} from '@household-os/shared/types';

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
    swap: (item_key: string, replacement_key?: string) =>
      request<TodayPlan>('/today/swap', {
        method: 'POST',
        body: JSON.stringify({ item_key, replacement_key }),
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
  chat: (
    persona: string,
    messages: { role: 'user' | 'assistant'; content: string }[],
  ) =>
    request<{ reply: string; messages: { role: string; content: string }[] }>(
      `/chat/${persona}`,
      { method: 'POST', body: JSON.stringify({ messages }) },
    ),
};
