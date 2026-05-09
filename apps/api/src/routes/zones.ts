import { Router } from 'express';
import {
  cancelAdHocTask,
  latestAssessmentByZone,
  listOpenAdHocTasks,
  listRecentAssessments,
} from '../services/zones.js';

const router: Router = Router();

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

router.post('/tasks/:id/cancel', async (req, res) => {
  const task = await cancelAdHocTask(req.params.id!);
  if (!task) {
    res.status(404).json({ error: 'task not found' });
    return;
  }
  res.json(task);
});

export default router;
