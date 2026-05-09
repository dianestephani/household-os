import { Router } from 'express';
import { recentActivity } from '../services/activity.js';
import type { ActivityKind } from '@household-os/shared/types';

const router: Router = Router();

router.get('/', async (req, res) => {
  const days = Number(req.query.days ?? 14);
  const kind = (req.query.kind as ActivityKind | undefined) || undefined;
  res.json(await recentActivity(days, kind));
});

export default router;
