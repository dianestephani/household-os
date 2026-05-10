import { Router } from 'express';
import { activityOnDate, recentActivity } from '../services/activity.js';
import type { ActivityKind } from '@household-os/shared/types';

const router: Router = Router();

router.get('/', async (req, res) => {
  const kind = (req.query.kind as ActivityKind | undefined) || undefined;
  // Single-day mode wins if both params are present.
  const date = typeof req.query.date === 'string' ? req.query.date : undefined;
  if (date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ error: 'date must be YYYY-MM-DD' });
      return;
    }
    res.json(await activityOnDate(date, kind));
    return;
  }
  const days = Number(req.query.days ?? 14);
  res.json(await recentActivity(days, kind));
});

export default router;
