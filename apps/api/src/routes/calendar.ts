import { Router } from 'express';
import { todaysEvents } from '../services/calendar.js';

const router: Router = Router();

router.get('/today', async (_req, res) => {
  res.json(await todaysEvents());
});

export default router;
