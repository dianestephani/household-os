import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { google, type calendar_v3 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';

let cachedClient: calendar_v3.Calendar | null = null;
let cachedAttempted = false;

// Same anchoring trick as google-auth.ts so paths work from any cwd.
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

export function getCalendarClient(): calendar_v3.Calendar | null {
  if (cachedAttempted) return cachedClient;
  cachedAttempted = true;
  const auth = loadOAuthClient();
  if (!auth) {
    console.warn(
      '[calendar] no Google Calendar credentials — calendar features will no-op',
    );
    return null;
  }
  cachedClient = google.calendar({ version: 'v3', auth });
  return cachedClient;
}

export async function listEvents(
  timeMinIso: string,
  timeMaxIso: string,
): Promise<calendar_v3.Schema$Event[]> {
  // Tests should never hit the real calendar — results depend on whatever's
  // actually scheduled and make assertions flaky. NODE_ENV=test is set by
  // vitest automatically.
  if (process.env.NODE_ENV === 'test') return [];
  const cal = getCalendarClient();
  if (!cal) return [];
  const calendarId = process.env.GOOGLE_CALENDAR_ID ?? 'primary';
  try {
    const res = await cal.events.list({
      calendarId,
      timeMin: timeMinIso,
      timeMax: timeMaxIso,
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 100,
    });
    return res.data.items ?? [];
  } catch (err) {
    console.error('[calendar] events.list failed', err);
    return [];
  }
}

export async function upsertEvent(
  eventBody: calendar_v3.Schema$Event,
  existingId?: string | null,
): Promise<string | null> {
  if (process.env.NODE_ENV === 'test') return null;
  const cal = getCalendarClient();
  if (!cal) return null;
  const calendarId = process.env.GOOGLE_CALENDAR_ID ?? 'primary';
  try {
    if (existingId) {
      const res = await cal.events.patch({
        calendarId,
        eventId: existingId,
        requestBody: eventBody,
      });
      return res.data.id ?? existingId;
    }
    const res = await cal.events.insert({
      calendarId,
      requestBody: eventBody,
    });
    return res.data.id ?? null;
  } catch (err) {
    console.error('[calendar] upsert failed', err);
    return existingId ?? null;
  }
}
