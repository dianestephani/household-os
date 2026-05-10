import type { Request, Response, NextFunction } from 'express';
import { verifySession } from '../services/session.js';

/**
 * Single gate covering both legacy + session-based auth so we don't have to
 * fork callers. Order of precedence (first match wins):
 *
 *   1. No bearer token expected at all (neither API_TOKEN nor GOOGLE_OAUTH_CLIENT_ID
 *      configured) → open access. Useful for local dev with no auth yet.
 *   2. Bearer matches API_TOKEN exactly → allow. Lets Alexa skill + scripts
 *      keep using a static token.
 *   3. Bearer parses as a valid session JWT → allow. This is the browser
 *      login flow path.
 *   4. Otherwise → 401.
 */
export function requireToken(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const apiToken = process.env.API_TOKEN;
  const googleConfigured = !!process.env.GOOGLE_OAUTH_CLIENT_ID;

  if (!apiToken && !googleConfigured) {
    next();
    return;
  }

  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const token = header.slice('Bearer '.length).trim();

  if (apiToken && token === apiToken) {
    next();
    return;
  }

  if (googleConfigured) {
    try {
      verifySession(token);
      next();
      return;
    } catch {
      // fall through to 401
    }
  }

  res.status(401).json({ error: 'unauthorized' });
}
