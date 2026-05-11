import { Router } from 'express';
import {
  addItemsToShoppingList,
} from '../services/alexa-shopping-list.js';
import { alexaLwaConfigured, saveAccessToken } from '../services/alexa-lwa.js';

/**
 * HARD RULE (mirrors the service): this router only ever pushes items to
 * Alexa's Household Shopping List. It never touches an Amazon cart, never
 * calls the Marketplace API, never places orders. Diane's shopping list
 * is a passive checklist for in-person shopping. See §47 Phase 6b in
 * HANDOFF — and the service module's top-of-file comment for the same
 * rule restated.
 */

const MAX_ITEMS = 100;

const router: Router = Router();

router.get('/auth-status', async (_req, res) => {
  res.json({ configured: await alexaLwaConfigured() });
});

router.post('/shopping-list/add', async (req, res) => {
  const body = (req.body ?? {}) as { items?: unknown };
  if (!Array.isArray(body.items)) {
    res.status(400).json({ error: 'items must be a string array' });
    return;
  }
  const items = body.items
    .filter((s): s is string => typeof s === 'string')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (items.length === 0) {
    res.status(400).json({ error: 'no items provided' });
    return;
  }
  if (items.length > MAX_ITEMS) {
    res.status(413).json({ error: `too many items (max ${MAX_ITEMS})` });
    return;
  }
  const result = await addItemsToShoppingList(items);
  if (result.status === 'no_token') {
    res.status(503).json({
      ...result,
      help:
        'Alexa Lists permission not configured yet. Grant the skill "Lists Read/Write" in the Alexa app, then re-link the account so we receive an access token.',
    });
    return;
  }
  res.json(result);
});

/**
 * Manual token-save endpoint, used by the one-time LWA account-linking
 * flow. Diane runs this once after granting permissions in the Alexa app;
 * thereafter, refreshes happen automatically via the refresh_token.
 *
 * Locked down by the standard `/api/*` requireToken middleware (mounted on
 * `/api/alexa` in index.ts) — only authenticated dashboard / curl requests
 * can hit it. The body is the JSON Amazon returns from the token exchange.
 */
router.post('/lwa/save-token', async (req, res) => {
  const body = (req.body ?? {}) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };
  if (typeof body.access_token !== 'string' || !body.access_token) {
    res.status(400).json({ error: 'access_token required' });
    return;
  }
  await saveAccessToken({
    access_token: body.access_token,
    refresh_token: body.refresh_token,
    expires_in_seconds: body.expires_in,
    scopes: body.scope ? body.scope.split(/\s+/) : undefined,
  });
  res.json({ saved: true });
});

export default router;
