import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { google, type tasks_v1 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';

/**
 * Google Tasks client (the to-do product whose items render on the Calendar
 * grid). Reuses the same `google-creds.json` / `google-token.json` that the
 * Calendar integration uses — but the token must have been minted with the
 * `tasks` scope. Re-run `npm -w @household-os/api run google-auth` after
 * pulling this change so the saved token carries the broader scope.
 */

let cachedClient: tasks_v1.Tasks | null = null;
let cachedAttempted = false;

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../..',
);

function loadOAuthClient(): OAuth2Client | null {
  const credPath =
    process.env.GOOGLE_CALENDAR_CREDENTIALS_PATH ||
    path.join(repoRoot, 'google-creds.json');
  const tokenPath =
    process.env.GOOGLE_CALENDAR_TOKEN_PATH ||
    path.join(repoRoot, 'google-token.json');
  if (!fs.existsSync(credPath) || !fs.existsSync(tokenPath)) return null;

  const creds = JSON.parse(fs.readFileSync(credPath, 'utf8'));
  const token = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
  const installed = creds.installed ?? creds.web;
  const oauth = new google.auth.OAuth2(
    installed.client_id,
    installed.client_secret,
    installed.redirect_uris?.[0],
  );
  oauth.setCredentials(token);
  return oauth;
}

export function getTasksClient(): tasks_v1.Tasks | null {
  if (cachedAttempted) return cachedClient;
  cachedAttempted = true;
  const auth = loadOAuthClient();
  if (!auth) {
    console.warn(
      '[tasks] no Google credentials — Tasks features will no-op',
    );
    return null;
  }
  cachedClient = google.tasks({ version: 'v1', auth });
  return cachedClient;
}

export function isTasksConnected(): boolean {
  if (process.env.NODE_ENV === 'test') return false;
  return getTasksClient() !== null;
}

/**
 * Fetch every task across every tasklist. We don't pre-filter by date here —
 * the Tasks API supports `dueMin` / `dueMax` but the semantics are subtle
 * (timezone, all-day-vs-timed) so the service layer does its own filtering
 * against a known local-day window.
 */
export async function listAllTasks(): Promise<
  { tasklistId: string; task: tasks_v1.Schema$Task }[]
> {
  if (process.env.NODE_ENV === 'test') return [];
  const client = getTasksClient();
  if (!client) return [];

  try {
    const lists = await client.tasklists.list({ maxResults: 100 });
    const tasklists = lists.data.items ?? [];
    const out: { tasklistId: string; task: tasks_v1.Schema$Task }[] = [];
    for (const tl of tasklists) {
      if (!tl.id) continue;
      const res = await client.tasks.list({
        tasklist: tl.id,
        showCompleted: true,
        showHidden: false,
        maxResults: 100,
      });
      for (const t of res.data.items ?? []) {
        out.push({ tasklistId: tl.id, task: t });
      }
    }
    return out;
  } catch (err) {
    console.error('[tasks] listAllTasks failed', err);
    return [];
  }
}

export async function patchTaskStatus(
  tasklistId: string,
  taskId: string,
  status: 'needsAction' | 'completed',
): Promise<tasks_v1.Schema$Task | null> {
  if (process.env.NODE_ENV === 'test') return null;
  const client = getTasksClient();
  if (!client) return null;
  try {
    const res = await client.tasks.patch({
      tasklist: tasklistId,
      task: taskId,
      requestBody: { status },
    });
    return res.data;
  } catch (err) {
    console.error('[tasks] patchTaskStatus failed', err);
    return null;
  }
}
