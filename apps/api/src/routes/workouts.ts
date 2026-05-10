import { Router } from 'express';
import {
  logWorkout,
  recentWorkouts,
  todaysWorkout,
} from '../services/workouts.js';
import { parseYmd } from '../utils/dates.js';
import type {
  EnergyLevel,
  MoodLevel,
  WorkoutSlotKey,
  WorkoutStatus,
} from '@household-os/shared/types';

const router: Router = Router();

const VALID_STATUS: WorkoutStatus[] = ['done', 'skipped', 'partial'];
const VALID_SLOTS: WorkoutSlotKey[] = ['pt_tue', 'pt_thu', 'lift_flex', 'ad_hoc'];

router.get('/', async (req, res) => {
  const days = Number(req.query.days ?? 14);
  res.json(await recentWorkouts(days));
});

router.get('/today', async (_req, res) => {
  res.json(await todaysWorkout());
});

router.get('/by-date/:date', async (req, res) => {
  const date = req.params.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    return;
  }
  res.json(await todaysWorkout(parseYmd(date)));
});

router.post('/', async (req, res) => {
  const body = (req.body ?? {}) as {
    slot_key?: WorkoutSlotKey;
    status?: WorkoutStatus;
    date?: string;
    mood?: MoodLevel;
    energy?: EnergyLevel;
    notes?: string;
  };
  if (!body.slot_key || !VALID_SLOTS.includes(body.slot_key)) {
    res.status(400).json({ error: 'slot_key required' });
    return;
  }
  if (!body.status || !VALID_STATUS.includes(body.status)) {
    res.status(400).json({ error: 'status must be done|skipped|partial' });
    return;
  }
  const log = await logWorkout({
    slot_key: body.slot_key,
    status: body.status,
    date: body.date,
    mood: body.mood,
    energy: body.energy,
    notes: body.notes,
  });
  res.status(201).json(log);
});

export default router;
