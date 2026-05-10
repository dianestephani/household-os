import { Router } from 'express';
import {
  addContext,
  contextOnDate,
  recentContext,
  todaysContext,
} from '../services/context.js';
import type {
  ContextEntryInput,
  ContextRelatedPersona,
} from '@household-os/shared/types';

const router: Router = Router();

router.get('/', async (req, res) => {
  const persona = req.query.persona as ContextRelatedPersona | undefined;
  // Single-day mode wins if both `date` and `days` are provided.
  const date = typeof req.query.date === 'string' ? req.query.date : undefined;
  if (date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ error: 'date must be YYYY-MM-DD' });
      return;
    }
    res.json(await contextOnDate(date, persona));
    return;
  }
  const days = Number(req.query.days ?? 7);
  res.json(await recentContext(Number.isFinite(days) ? days : 7, persona));
});

router.get('/today', async (req, res) => {
  const persona = req.query.persona as ContextRelatedPersona | undefined;
  res.json(await todaysContext(persona));
});

router.post('/', async (req, res) => {
  const body = (req.body ?? {}) as ContextEntryInput;
  if (!body.text || typeof body.text !== 'string' || !body.text.trim()) {
    res.status(400).json({ error: 'text is required' });
    return;
  }
  res.json(
    await addContext({
      ...body,
      source: body.source ?? 'dashboard',
    }),
  );
});

export default router;
