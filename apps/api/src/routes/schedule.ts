import { Router } from 'express';
import { scheduleRange } from '../services/schedule.js';

const router: Router = Router();

router.get('/', async (req, res) => {
  const days = Number(req.query.days ?? 7);
  res.json(await scheduleRange(new Date(), Number.isFinite(days) ? days : 7));
});

export default router;
