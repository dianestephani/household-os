import { Router } from 'express';
import { logEnergy, suggestSwaps } from '../services/energy.js';
import type { EnergyLevel } from '@household-os/shared/types';

const router: Router = Router();

const VALID: EnergyLevel[] = ['low', 'medium', 'high'];

router.post('/', async (req, res) => {
  const { level, source } = (req.body ?? {}) as {
    level?: EnergyLevel;
    source?: 'voice' | 'dashboard' | 'shortcut' | 'cron-default';
  };
  if (!level || !VALID.includes(level)) {
    res.status(400).json({ error: 'level must be low|medium|high' });
    return;
  }
  await logEnergy(level, source ?? 'dashboard');
  const suggestion = await suggestSwaps(level);
  res.json(suggestion);
});

export default router;
