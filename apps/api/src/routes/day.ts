import { Router } from 'express';
import { getDayView } from '../services/day.js';

const router: Router = Router();

router.get('/:date', async (req, res) => {
  const date = req.params.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    return;
  }
  res.json(await getDayView(date));
});

export default router;
