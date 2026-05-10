/**
 * One-time OAuth helper for Google Calendar.
 *
 * Reads `google-creds.json` (downloaded from Google Cloud Console), runs the
 * authorization-code flow against a local HTTP server, and writes the resulting
 * access + refresh token to `google-token.json`. After this runs once, the API
 * picks up the saved token automatically.
 *
 * Run with: `npm run google-auth`
 */
import 'dotenv/config';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { google } from 'googleapis';

// Resolve paths from this script's location (apps/api/src/google-auth.ts → ../../..)
// so the npm-workspace cwd (apps/api/) doesn't matter.
const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);
const credsPath =
  process.env.GOOGLE_CALENDAR_CREDENTIALS_PATH ||
  path.join(repoRoot, 'google-creds.json');
const tokenPath =
  process.env.GOOGLE_CALENDAR_TOKEN_PATH ||
  path.join(repoRoot, 'google-token.json');

const PORT = 53682;
const REDIRECT_URI = `http://localhost:${PORT}/`;
const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  // Google Tasks (the to-do product whose items render on the Calendar grid).
  // Adding this scope requires re-consent: re-run `npm run google-auth` after
  // pulling. The new token replaces the old one and works for both products.
  'https://www.googleapis.com/auth/tasks',
];

if (!fs.existsSync(credsPath)) {
  console.error(`No credentials at ${credsPath}.`);
  console.error(
    'Download the OAuth client JSON from Google Cloud Console first and save it there.',
  );
  process.exit(1);
}

interface InstalledOrWeb {
  client_id: string;
  client_secret: string;
}
const credsRaw = JSON.parse(fs.readFileSync(credsPath, 'utf8')) as {
  installed?: InstalledOrWeb;
  web?: InstalledOrWeb;
};
const installed = credsRaw.installed ?? credsRaw.web;
if (!installed?.client_id || !installed?.client_secret) {
  console.error(
    'Unrecognized credential JSON. Expected an `installed` or `web` block with client_id + client_secret.',
  );
  process.exit(1);
}

const oauth = new google.auth.OAuth2(
  installed.client_id,
  installed.client_secret,
  REDIRECT_URI,
);

const authUrl = oauth.generateAuthUrl({
  access_type: 'offline',
  scope: SCOPES,
  prompt: 'consent', // ensures Google issues a refresh_token, even on re-auth
});

console.log('\n=== Google Calendar — one-time authorization ===\n');
console.log('Open this URL in your browser:\n');
console.log(authUrl);
console.log('\nWaiting for callback on', REDIRECT_URI, '...\n');

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url ?? '/', REDIRECT_URI);
    const code = u.searchParams.get('code');
    const error = u.searchParams.get('error');

    if (error) {
      res.writeHead(400, { 'content-type': 'text/plain' });
      res.end(`Authorization error: ${error}`);
      console.error('Authorization error:', error);
      server.close();
      process.exit(1);
    }

    if (!code) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Not found');
      return;
    }

    const { tokens } = await oauth.getToken(code);
    fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2));

    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(
      '<h1>Authorized ✅</h1><p>You can close this tab and return to your terminal.</p>',
    );
    console.log(`Saved token to ${tokenPath}`);
    if (!tokens.refresh_token) {
      console.warn(
        '\n⚠️  No refresh_token was issued. The access token will expire in ~1 hour.',
      );
      console.warn(
        '    To force a refresh_token, revoke the app at https://myaccount.google.com/permissions',
      );
      console.warn('    then re-run `npm run google-auth`.\n');
    }
    server.close();
    process.exit(0);
  } catch (err) {
    console.error('Token exchange failed:', err);
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('Token exchange failed; see terminal output.');
    server.close();
    process.exit(1);
  }
});

server.listen(PORT, () => {
  /* listening message printed above */
});
