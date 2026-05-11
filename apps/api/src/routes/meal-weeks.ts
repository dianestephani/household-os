import { Router } from 'express';
import {
  adjacentMealWeeks,
  deleteMealWeek,
  getMealWeek,
  getMealWeekByDate,
  listMealWeeks,
  upsertMealWeek,
} from '../services/meal-weeks.js';

const router: Router = Router();

router.get('/', async (req, res) => {
  const limit = Number(req.query.limit ?? 26);
  res.json(await listMealWeeks(Number.isFinite(limit) ? limit : 26));
});

router.get('/by-date/:date', async (req, res) => {
  const date = req.params.date!;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    return;
  }
  const week = await getMealWeekByDate(date);
  res.json({ week, requested_date: date });
});

router.get('/:start_date/adjacent', async (req, res) => {
  const startDate = req.params.start_date!;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    res.status(400).json({ error: 'start_date must be YYYY-MM-DD' });
    return;
  }
  res.json(await adjacentMealWeeks(startDate));
});

router.get('/:start_date', async (req, res) => {
  const startDate = req.params.start_date!;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    res.status(400).json({ error: 'start_date must be YYYY-MM-DD' });
    return;
  }
  const week = await getMealWeek(startDate);
  if (!week) {
    res.status(404).json({ error: 'meal week not found' });
    return;
  }
  res.json(week);
});

router.post('/', async (req, res) => {
  try {
    const body = (req.body ?? {}) as {
      start_date?: string;
      title?: string;
      meals?: unknown[];
    };
    const result = await upsertMealWeek({
      start_date: body.start_date ?? '',
      title: body.title,
      meals: body.meals ?? [],
    });
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'invalid meal week',
    });
  }
});

router.delete('/:start_date', async (req, res) => {
  const startDate = req.params.start_date!;
  const ok = await deleteMealWeek(startDate);
  if (!ok) {
    res.status(404).json({ error: 'meal week not found' });
    return;
  }
  res.json({ deleted: true });
});

export default router;
