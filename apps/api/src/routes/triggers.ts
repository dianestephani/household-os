import { Router } from 'express';
import { addTrigger, listUpcomingTriggers } from '../services/triggers.js';
import type { TriggerType } from '@household-os/shared/types';

const router: Router = Router();

router.get('/', async (_req, res) => {
  res.json(await listUpcomingTriggers());
});

router.post('/', async (req, res) => {
  const { type, date, notes } = (req.body ?? {}) as {
    type?: TriggerType;
    date?: string;
    notes?: string;
  };
  if (!type || !date) {
    res.status(400).json({ error: 'type and date required (date as YYYY-MM-DD)' });
    return;
  }
  res.status(201).json(await addTrigger({ type, date, notes }));
});

export default router;
