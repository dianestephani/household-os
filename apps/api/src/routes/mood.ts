import { Router } from 'express';
import { logMood, recentMoods } from '../services/mood.js';
import type { MoodLevel, WellbeingSource } from '@household-os/shared/types';

const router: Router = Router();

const VALID: MoodLevel[] = ['good', 'neutral', 'down'];

router.post('/', async (req, res) => {
  const { level, source } = (req.body ?? {}) as {
    level?: MoodLevel;
    source?: WellbeingSource;
  };
  if (!level || !VALID.includes(level)) {
    res.status(400).json({ error: 'level must be good|neutral|down' });
    return;
  }
  const log = await logMood(level, source ?? 'dashboard');
  res.status(201).json(log);
});

router.get('/', async (req, res) => {
  const days = Number(req.query.days ?? 14);
  res.json(await recentMoods(days));
});

export default router;
