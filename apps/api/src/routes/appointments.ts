import { Router } from 'express';
import {
  clearAppointmentLink,
  createAppointment,
  reconcileAllAppointments,
  reconcileAppointment,
} from '../services/appointments.js';

const router: Router = Router();

router.post('/reconcile-all', async (_req, res) => {
  res.json(await reconcileAllAppointments());
});

router.post('/:routine_key', async (req, res) => {
  const routineKey = req.params.routine_key!;
  const body = (req.body ?? {}) as {
    starts_at?: string;
    duration_minutes?: number;
  };
  if (!body.starts_at) {
    res.status(400).json({ error: 'starts_at required' });
    return;
  }
  try {
    const result = await createAppointment({
      routine_key: routineKey,
      starts_at: body.starts_at,
      duration_minutes: body.duration_minutes,
    });
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'could not create appointment',
    });
  }
});

router.post('/:routine_key/reconcile', async (req, res) => {
  res.json(await reconcileAppointment(req.params.routine_key!));
});

router.delete('/:routine_key', async (req, res) => {
  const updated = await clearAppointmentLink(req.params.routine_key!);
  if (!updated) {
    res.status(404).json({ error: 'routine not found' });
    return;
  }
  res.json(updated);
});

export default router;
