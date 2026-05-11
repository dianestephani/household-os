import { AlexaAuth } from '../db/models/AlexaAuth.js';

/**
 * Login-with-Amazon access token plumbing for §47 Phase 6 (Reminders +
 * Shopping List). The model:
 *
 *   1. Diane grants `alexa::household:lists:write` and/or
 *      `alexa::devices:all:reminders:write` to the skill in the Alexa app.
 *   2. Amazon delivers an `accessToken` to the skill via the
 *      AlexaHouseholdListEvent / Reminders Events subscription, OR via the
 *      LWA refresh-token flow if we've stored one.
 *   3. We persist it in `AlexaAuth` (singleton, key='self').
 *   4. `getValidAccessToken()` returns a fresh token, refreshing if needed.
 *
 * In dev / NODE_ENV=test (and any time no auth doc exists), every call
 * returns `null` so the Reminders + Lists services no-op safely. The
 * `alexaLwaConfigured()` helper lets routes return a clear 503 instead of
 * silently failing.
 */

const REFRESH_WINDOW_MS = 5 * 60 * 1000; // 5 min before expiry

export interface AlexaCreds {
  access_token: string;
  expires_at: Date;
  scopes: string[];
}

export async function alexaLwaConfigured(): Promise<boolean> {
  if (process.env.NODE_ENV === 'test') return false;
  const doc = await AlexaAuth.findOne({ key: 'self' }).lean();
  return !!doc?.access_token;
}

/**
 * Persist a token (e.g. when received from a skill event or OAuth callback).
 * Treats `expires_in` (seconds) the same way Amazon's LWA endpoint sends it.
 */
export async function saveAccessToken(input: {
  access_token: string;
  refresh_token?: string;
  expires_in_seconds?: number;
  scopes?: string[];
}): Promise<void> {
  const expiresAt = new Date(
    Date.now() + (input.expires_in_seconds ?? 3600) * 1000,
  );
  const set: Record<string, unknown> = {
    access_token: input.access_token,
    expires_at: expiresAt,
    updated_at: new Date(),
  };
  if (input.refresh_token) set.refresh_token = input.refresh_token;
  if (input.scopes) set.scopes = input.scopes.join(' ');
  await AlexaAuth.findOneAndUpdate(
    { key: 'self' },
    { $set: set, $setOnInsert: { key: 'self' } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
}

/**
 * Returns a valid access token or null. Triggers refresh if we're within
 * `REFRESH_WINDOW_MS` of expiry AND we have a refresh_token + LWA client
 * credentials. Returns null on any failure (caller must no-op cleanly).
 */
export async function getValidAccessToken(): Promise<AlexaCreds | null> {
  if (process.env.NODE_ENV === 'test') return null;
  const doc = await AlexaAuth.findOne({ key: 'self' }).lean();
  if (!doc?.access_token) return null;

  const expiresAt = doc.expires_at ? new Date(doc.expires_at) : null;
  const needsRefresh =
    !expiresAt ||
    expiresAt.getTime() - Date.now() < REFRESH_WINDOW_MS;

  if (!needsRefresh) {
    return {
      access_token: doc.access_token,
      expires_at: expiresAt!,
      scopes: (doc.scopes ?? '').split(/\s+/).filter(Boolean),
    };
  }

  const refreshed = await refreshFromAmazon(doc.refresh_token ?? '');
  if (!refreshed) {
    // If we can't refresh, return what we have IF it hasn't actually expired
    // yet (might still work for a few seconds), otherwise null.
    if (expiresAt && expiresAt.getTime() > Date.now()) {
      return {
        access_token: doc.access_token,
        expires_at: expiresAt,
        scopes: (doc.scopes ?? '').split(/\s+/).filter(Boolean),
      };
    }
    return null;
  }

  await saveAccessToken(refreshed);
  return {
    access_token: refreshed.access_token,
    expires_at: new Date(
      Date.now() + (refreshed.expires_in_seconds ?? 3600) * 1000,
    ),
    scopes: refreshed.scopes ?? [],
  };
}

interface RefreshResult {
  access_token: string;
  refresh_token?: string;
  expires_in_seconds?: number;
  scopes?: string[];
}

async function refreshFromAmazon(
  refreshToken: string,
): Promise<RefreshResult | null> {
  if (!refreshToken) return null;
  const clientId = process.env.ALEXA_CLIENT_ID;
  const clientSecret = process.env.ALEXA_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  try {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    });
    const res = await fetch('https://api.amazon.com/auth/o2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) {
      console.error(
        `[alexa-lwa] refresh failed: ${res.status} ${await res.text()}`,
      );
      return null;
    }
    const data = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
    };
    if (!data.access_token) return null;
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in_seconds: data.expires_in,
      scopes: data.scope ? data.scope.split(/\s+/) : undefined,
    };
  } catch (err) {
    console.error('[alexa-lwa] refresh threw', err);
    return null;
  }
}
