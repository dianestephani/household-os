import { Router } from 'express';
import {
  listRoutines,
  getRoutine,
  patchRoutine,
  createRoutine,
  softDeleteRoutine,
} from '../services/routines.js';
import type { CadenceShiftStrategy } from '@household-os/shared/types';

const VALID_STRATEGIES: CadenceShiftStrategy[] = [
  'one_off',
  'shift_all',
  'skip_one',
];

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
  // §50 Phase E — strip `cadence_shift_strategy` out of the patch body and
  // pass it as an option instead. The allow-list inside `patchRoutine` would
  // drop it silently anyway, but pulling it here keeps responsibilities clean.
  const body = (req.body ?? {}) as Record<string, unknown> & {
    cadence_shift_strategy?: CadenceShiftStrategy;
  };
  const { cadence_shift_strategy: rawStrategy, ...patch } = body;
  const strategy =
    rawStrategy && VALID_STRATEGIES.includes(rawStrategy as CadenceShiftStrategy)
      ? (rawStrategy as CadenceShiftStrategy)
      : undefined;
  const r = await patchRoutine(req.params.key!, patch, {
    cadence_shift_strategy: strategy,
  });
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
