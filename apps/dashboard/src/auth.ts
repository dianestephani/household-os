/**
 * Dashboard-side auth state. The login wall is enabled when
 * VITE_GOOGLE_OAUTH_CLIENT_ID is set at build time; otherwise the dashboard
 * goes straight through (useful for local dev that hasn't configured OAuth).
 *
 * Session token is stored in `sessionStorage` so it clears when the tab
 * closes — matching the "I have to log in every time I click the demo link"
 * UX requirement.
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
    const token = sessionStorage.getItem(SESSION_KEY);
    const email = sessionStorage.getItem(EMAIL_KEY);
    if (!token || !email) return null;
    return {
      token,
      email,
      name: sessionStorage.getItem(NAME_KEY) ?? undefined,
      picture: sessionStorage.getItem(PICTURE_KEY) ?? undefined,
    };
  } catch {
    return null;
  }
}

export function writeSession(s: AuthSession): void {
  try {
    sessionStorage.setItem(SESSION_KEY, s.token);
    sessionStorage.setItem(EMAIL_KEY, s.email);
    if (s.name) sessionStorage.setItem(NAME_KEY, s.name);
    if (s.picture) sessionStorage.setItem(PICTURE_KEY, s.picture);
  } catch {
    /* sessionStorage unavailable */
  }
}

export function clearSession(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(EMAIL_KEY);
    sessionStorage.removeItem(NAME_KEY);
    sessionStorage.removeItem(PICTURE_KEY);
  } catch {
    /* sessionStorage unavailable */
  }
}
