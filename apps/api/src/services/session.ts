import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';

/**
 * Two pieces of session machinery, kept thin:
 *
 *   1. `verifyGoogleIdToken` — given the JWT Google Identity Services hands the
 *      browser on a successful sign-in, prove it's real (signature against
 *      Google's JWKS), check that it was issued to *our* OAuth client, and
 *      return the email + name.
 *
 *   2. `signSession` / `verifySession` — once we trust the Google identity,
 *      we issue our own short-lived signed JWT. That's what the browser sends
 *      back on every API call. We never re-validate against Google after that.
 *
 * Allowlist is enforced at issuance time only: see `isAllowedEmail`. The
 * session token itself doesn't carry an "allowed" claim — anything that holds
 * a valid signed session is by definition already past the allowlist.
 */

export interface GoogleVerified {
  email: string;
  email_verified: boolean;
  name?: string;
  picture?: string;
  sub: string; // Google user ID
}

export interface Session {
  email: string;
  iat?: number;
  exp?: number;
}

const SESSION_EXPIRY_SECONDS = 30 * 24 * 60 * 60; // 30 days — paired with localStorage in the browser so a sign-in sticks across tabs + restarts

let cachedOAuthClient: OAuth2Client | null = null;

function getOAuthClient(): OAuth2Client {
  if (cachedOAuthClient) return cachedOAuthClient;
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  if (!clientId) {
    throw new Error(
      'GOOGLE_OAUTH_CLIENT_ID is not set — cannot verify Google ID tokens',
    );
  }
  cachedOAuthClient = new OAuth2Client(clientId);
  return cachedOAuthClient;
}

export async function verifyGoogleIdToken(
  idToken: string,
): Promise<GoogleVerified> {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  if (!clientId) throw new Error('GOOGLE_OAUTH_CLIENT_ID missing');

  const ticket = await getOAuthClient().verifyIdToken({
    idToken,
    audience: clientId,
  });
  const payload = ticket.getPayload();
  if (!payload || !payload.email) {
    throw new Error('Google ID token had no email');
  }
  return {
    email: payload.email,
    email_verified: payload.email_verified === true,
    name: payload.name,
    picture: payload.picture,
    sub: payload.sub,
  };
}

/**
 * Allowed-email check. `AUTH_ALLOWED_EMAIL` is comma-separated for the
 * occasional case where you want to add a second account (e.g. a recruiter
 * you're sharing the demo with).
 */
export function isAllowedEmail(email: string): boolean {
  const raw = process.env.AUTH_ALLOWED_EMAIL ?? '';
  if (!raw.trim()) return false;
  const allowed = raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(email.toLowerCase());
}

function getJwtSecret(): string {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 16) {
    throw new Error(
      'JWT_SECRET must be set to a value of at least 16 characters',
    );
  }
  return s;
}

export function signSession(email: string): string {
  return jwt.sign({ email }, getJwtSecret(), {
    expiresIn: SESSION_EXPIRY_SECONDS,
  });
}

export function verifySession(token: string): Session {
  return jwt.verify(token, getJwtSecret()) as Session;
}
