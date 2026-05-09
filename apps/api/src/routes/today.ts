import { Router } from 'express';
import {
  getToday,
  regenerateToday,
  swapTask,
  markDone,
  pullFromPool,
} from '../services/today.js';

const router: Router = Router();

router.get('/', async (_req, res) => {
  const plan = await getToday();
  res.json(plan);
});

router.post('/regenerate', async (_req, res) => {
  const plan = await regenerateToday();
  res.json(plan);
});

router.post('/swap', async (req, res) => {
  const { item_key, replacement_key } = req.body ?? {};
  if (!item_key) {
    res.status(400).json({ error: 'item_key required' });
    return;
  }
  const plan = await swapTask(item_key, replacement_key);
  res.json(plan);
});

router.post('/mark-done', async (req, res) => {
  const { item_key } = req.body ?? {};
  if (!item_key) {
    res.status(400).json({ error: 'item_key required' });
    return;
  }
  const plan = await markDone(item_key);
  res.json(plan);
});

router.post('/pull-from-pool', async (req, res) => {
  const { item_key } = req.body ?? {};
  if (!item_key) {
    res.status(400).json({ error: 'item_key required' });
    return;
  }
  const plan = await pullFromPool(item_key);
  res.json(plan);
});

export default router;
