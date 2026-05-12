import { Router } from 'express';
import {
  getCurrent,
  resetToSeed,
  update,
} from '../services/assistant-settings.js';

/**
 * Live system-prompt singleton for the unified assistant. §50 Phase A.
 *   GET   /api/assistant-settings        → current prompt + versions
 *   PATCH /api/assistant-settings        → body {system_prompt}; pushes a new version
 *   POST  /api/assistant-settings/reset  → restore the seed
 */

const router: Router = Router();

router.get('/', async (_req, res) => {
  res.json(await getCurrent());
});

router.patch('/', async (req, res) => {
  const body = (req.body ?? {}) as { system_prompt?: string };
  if (typeof body.system_prompt !== 'string') {
    res.status(400).json({ error: 'system_prompt (string) required' });
    return;
  }
  try {
    res.json(await update(body.system_prompt));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.post('/reset', async (_req, res) => {
  res.json(await resetToSeed());
});

export default router;
