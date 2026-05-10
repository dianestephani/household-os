/**
 * Dashboard-side auth state. The login wall is enabled when
 * VITE_GOOGLE_OAUTH_CLIENT_ID is set at build time; otherwise the dashboard
 * goes straight through (useful for local dev that hasn't configured OAuth).
 *
 * Session token is stored in `localStorage` so it persists across tabs +
 * browser restarts. Backend JWT expiry (~30 days) bounds how long any one
 * sign-in is valid; sign out clears the local copy explicitly.
 */

const SESSION_KEY = 'household-os.session';
const EMAIL_KEY = 'household-os.email';
const NAME_KEY = 'household-os.name';
const PICTURE_KEY = 'household-os.picture';

export const GOOGLE_OAUTH_CLIENT_ID: string =
  import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID ?? '';

export const AUTH_ENABLED = GOOGLE_OAUTH_CLIENT_ID.length > 0;

export interface AuthSession {
  token: string;
  email: string;
  name?: string;
  picture?: string;
}

export function readSession(): AuthSession | null {
  try {
    const token = localStorage.getItem(SESSION_KEY);
    const email = localStorage.getItem(EMAIL_KEY);
    if (!token || !email) return null;
    return {
      token,
      email,
      name: localStorage.getItem(NAME_KEY) ?? undefined,
      picture: localStorage.getItem(PICTURE_KEY) ?? undefined,
    };
  } catch {
    return null;
  }
}

export function writeSession(s: AuthSession): void {
  try {
    localStorage.setItem(SESSION_KEY, s.token);
    localStorage.setItem(EMAIL_KEY, s.email);
    if (s.name) localStorage.setItem(NAME_KEY, s.name);
    if (s.picture) localStorage.setItem(PICTURE_KEY, s.picture);
  } catch {
    /* localStorage unavailable */
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(EMAIL_KEY);
    localStorage.removeItem(NAME_KEY);
    localStorage.removeItem(PICTURE_KEY);
  } catch {
    /* localStorage unavailable */
  }
}
