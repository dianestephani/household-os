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

/**
 * §50 Phase F — slimmed surface. The skill only needs `GET /api/calendar/today`
 * to power the surviving `WhatsLeftIntent`. Everything else (today plan,
 * mood/energy log, zones, check-ins, patterns, chat) retired with the
 * intents in Phase C/F.
 */

export interface CalendarEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  is_all_day: boolean;
  location?: string;
  html_link?: string;
}

export interface CalendarDayResponse {
  date: string;
  connected: boolean;
  events: CalendarEvent[];
  open_in_calendar_url: string;
}

export const apiClient = {
  calendarToday: () => request<CalendarDayResponse>('/calendar/today'),
};
