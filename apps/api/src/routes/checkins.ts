import { Router } from 'express';
import {
  answerCheckIn,
  listPendingCheckIns,
  recentCheckIns,
  skipCheckIn,
} from '../services/checkins.js';

const router: Router = Router();

router.get('/pending', async (_req, res) => {
  res.json(await listPendingCheckIns());
});

router.get('/', async (req, res) => {
  const days = Number(req.query.days ?? 14);
  res.json(await recentCheckIns(days));
});

router.post('/:id/answer', async (req, res) => {
  const answers = (req.body?.answers ?? {}) as Record<string, string>;
  const result = await answerCheckIn(req.params.id!, answers);
  if (!result) {
    res.status(404).json({ error: 'check-in not found' });
    return;
  }
  res.json(result);
});

router.post('/:id/skip', async (req, res) => {
  const result = await skipCheckIn(req.params.id!);
  if (!result) {
    res.status(404).json({ error: 'check-in not found' });
    return;
  }
  res.json(result);
});

export default router;
