interface LwaToken {
  access_token: string;
  expires_at: number;
}

let cachedToken: LwaToken | null = null;

/**
 * Mint or refresh an LWA token for the Proactive Events scope.
 * Returns null if creds are missing — callers should treat that as a no-op.
 */
export async function getLwaToken(): Promise<string | null> {
  const id = process.env.ALEXA_CLIENT_ID;
  const secret = process.env.ALEXA_CLIENT_SECRET;
  if (!id || !secret) return null;
  if (cachedToken && Date.now() < cachedToken.expires_at - 60_000) {
    return cachedToken.access_token;
  }
  try {
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: id,
      client_secret: secret,
      scope: 'alexa::proactive_events',
    });
    const res = await fetch('https://api.amazon.com/auth/o2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) {
      console.error('[alexa] LWA token failed', res.status, await res.text());
      return null;
    }
    const data = (await res.json()) as { access_token: string; expires_in: number };
    cachedToken = {
      access_token: data.access_token,
      expires_at: Date.now() + data.expires_in * 1000,
    };
    return cachedToken.access_token;
  } catch (err) {
    console.error('[alexa] LWA token error', err);
    return null;
  }
}

interface ProactiveEvent {
  timestamp: string;
  referenceId: string;
  expiryTime: string;
  event: {
    name: string;
    payload: Record<string, unknown>;
  };
  localizedAttributes: { locale: string; bodyTemplate?: string }[];
  relevantAudience: { type: 'Multicast' | 'Unicast'; payload?: Record<string, unknown> };
}

/**
 * POST a Proactive Event to Alexa. Returns true if accepted, false otherwise
 * (including when creds are missing — callers should already treat absence
 * as a soft no-op).
 */
export async function pushProactiveEvent(event: ProactiveEvent): Promise<boolean> {
  const token = await getLwaToken();
  if (!token) {
    console.log('[alexa] no LWA creds — skipping proactive event');
    return false;
  }
  try {
    const res = await fetch('https://api.amazonalexa.com/v1/proactiveEvents', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(event),
    });
    if (!res.ok) {
      console.error('[alexa] proactiveEvents failed', res.status, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error('[alexa] proactiveEvents error', err);
    return false;
  }
}
