import { Router } from 'express';
import {
  cancelAdHocTask,
  latestAssessmentByZone,
  listOpenAdHocTasks,
  listRecentAssessments,
  recordAssessment,
  ZONES,
} from '../services/zones.js';
import type { Zone, ZoneStateLevel } from '@household-os/shared/types';

const router: Router = Router();

const VALID_LEVELS: ZoneStateLevel[] = ['fine', 'meh', 'rough'];

router.get('/state', async (_req, res) => {
  res.json(await latestAssessmentByZone());
});

router.get('/assessments', async (req, res) => {
  const days = Number(req.query.days ?? 14);
  res.json(await listRecentAssessments(days));
});

router.get('/tasks', async (_req, res) => {
  res.json(await listOpenAdHocTasks());
});

router.post('/assess', async (req, res) => {
  const { zone, level, notes } = (req.body ?? {}) as {
    zone?: Zone;
    level?: ZoneStateLevel;
    notes?: string;
  };
  if (!zone || !ZONES.includes(zone)) {
    res.status(400).json({ error: `zone must be one of ${ZONES.join(', ')}` });
    return;
  }
  if (!VALID_LEVELS.includes(level as ZoneStateLevel)) {
    res.status(400).json({ error: 'level must be fine|meh|rough' });
    return;
  }
  res.status(201).json(await recordAssessment(zone, level as ZoneStateLevel, notes));
});

router.post('/tasks/:id/cancel', async (req, res) => {
  const task = await cancelAdHocTask(req.params.id!);
  if (!task) {
    res.status(404).json({ error: 'task not found' });
    return;
  }
  res.json(task);
});

export default router;
