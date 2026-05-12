import { Router } from 'express';
import {
  getCheckin,
  recentCheckins,
  upsertCheckin,
} from '../services/morning-checkin.js';
import type {
  AwakenessLevel,
  EnergyLevel,
  MoodLevel,
} from '@household-os/shared/types';

/**
 * §50 Phase B — MorningCheckin REST surface.
 *   GET  /api/morning-checkin            → today's check-in (or null)
 *   GET  /api/morning-checkin/:date      → that date's check-in
 *   GET  /api/morning-checkin?days=N     → recent list (newest-first)
 *   POST /api/morning-checkin            → upsert (mood + energy + awakeness + note?)
 */

const router: Router = Router();

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

router.get('/', async (req, res) => {
  const days = req.query.days;
  if (typeof days === 'string') {
    const n = Number(days);
    res.json(await recentCheckins(Number.isFinite(n) ? n : 14));
    return;
  }
  res.json(await getCheckin());
});

router.get('/:date', async (req, res) => {
  const date = req.params.date;
  if (!YMD_RE.test(date)) {
    res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    return;
  }
  res.json(await getCheckin(date));
});

router.post('/', async (req, res) => {
  const body = (req.body ?? {}) as {
    date?: string;
    mood?: MoodLevel;
    energy?: EnergyLevel;
    awakeness?: AwakenessLevel;
    note?: string;
  };
  if (!body.mood || !body.energy || !body.awakeness) {
    res
      .status(400)
      .json({ error: 'mood, energy, and awakeness are required' });
    return;
  }
  try {
    res.json(
      await upsertCheckin({
        date: body.date,
        mood: body.mood,
        energy: body.energy,
        awakeness: body.awakeness,
        note: body.note,
      }),
    );
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

export default router;
