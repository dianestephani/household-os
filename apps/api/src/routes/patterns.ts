import { Router } from 'express';
import { frequentDeferrals, workoutSummary } from '../services/patterns.js';

const router: Router = Router();

router.get('/deferrals', async (req, res) => {
  const days = Number(req.query.days ?? 14);
  const min = Number(req.query.min ?? 2);
  res.json(await frequentDeferrals(days, min));
});

router.get('/workouts', async (req, res) => {
  const days = Number(req.query.days ?? 14);
  res.json(await workoutSummary(days));
});

export default router;
