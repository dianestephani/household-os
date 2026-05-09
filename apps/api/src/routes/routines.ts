import { Router } from 'express';
import {
  listRoutines,
  getRoutine,
  patchRoutine,
  createRoutine,
  softDeleteRoutine,
} from '../services/routines.js';

const router: Router = Router();

router.get('/', async (req, res) => {
  const { category, zone } = req.query as { category?: string; zone?: string };
  res.json(await listRoutines({ category, zone }));
});

router.get('/:key', async (req, res) => {
  const r = await getRoutine(req.params.key!);
  if (!r) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  res.json(r);
});

router.patch('/:key', async (req, res) => {
  const r = await patchRoutine(req.params.key!, req.body ?? {});
  res.json(r);
});

router.post('/', async (req, res) => {
  const r = await createRoutine(req.body ?? {});
  res.status(201).json(r);
});

router.delete('/:key', async (req, res) => {
  const r = await softDeleteRoutine(req.params.key!);
  res.json(r);
});

export default router;
