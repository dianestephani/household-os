import { TodayPlan } from '../db/models/TodayPlan.js';

interface LwaToken {
  access_token: string;
  expires_at: number;
}

let cachedToken: LwaToken | null = null;

async function getLwaToken(): Promise<string | null> {
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

function formatBody(plan: InstanceType<typeof TodayPlan>): string {
  const lines = (plan.items ?? []).map((it) => {
    const box = it.status === 'done' ? '✅' : '☐';
    return `${box} ${it.name} (${it.estimate_minutes} min)`;
  });
  return lines.join('\n');
}

export async function syncToAlexa(
  plan: InstanceType<typeof TodayPlan>,
): Promise<void> {
  const skillId = process.env.ALEXA_SKILL_ID;
  if (!skillId) {
    console.log('[alexa] no ALEXA_SKILL_ID — skipping push');
    return;
  }
  const token = await getLwaToken();
  if (!token) {
    console.log('[alexa] no LWA creds — skipping push');
    return;
  }

  const expiry = new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString();
  const event = {
    timestamp: new Date().toISOString(),
    referenceId: `household-${plan.date}-${Date.now()}`,
    expiryTime: expiry,
    event: {
      name: 'AMAZON.MessageAlert.Activated',
      payload: {
        state: { status: 'UNREAD', freshness: 'NEW' },
        messageGroup: {
          creator: { name: 'Household Ops' },
          count: (plan.items ?? []).filter((i) => i.status !== 'done').length,
        },
      },
    },
    localizedAttributes: [
      {
        locale: 'en-US',
        bodyTemplate: formatBody(plan),
      },
    ],
    relevantAudience: { type: 'Multicast', payload: {} },
  };

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
      return;
    }
    plan.publisher = plan.publisher ?? {};
    plan.publisher.alexa_notif_id = event.referenceId;
  } catch (err) {
    console.error('[alexa] proactiveEvents error', err);
  }
}
