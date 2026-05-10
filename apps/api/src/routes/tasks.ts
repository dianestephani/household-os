import { Router } from 'express';
import {
  completeTask,
  tasksForDay,
  tasksWithoutDueDate,
  uncompleteTask,
} from '../services/tasks.js';
import { ymd } from '../utils/dates.js';

const router: Router = Router();

router.get('/', async (req, res) => {
  const date = (req.query.date as string | undefined) ?? ymd(new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    return;
  }
  res.json(await tasksForDay(date));
});

router.get('/backlog', async (_req, res) => {
  res.json(await tasksWithoutDueDate());
});

router.post('/complete', async (req, res) => {
  const body = (req.body ?? {}) as { tasklist_id?: string; task_id?: string };
  if (!body.tasklist_id || !body.task_id) {
    res.status(400).json({ error: 'tasklist_id and task_id are required' });
    return;
  }
  const task = await completeTask(body.tasklist_id, body.task_id);
  if (!task) {
    res.status(502).json({ error: 'tasks_api_no_op' });
    return;
  }
  res.json(task);
});

router.post('/uncomplete', async (req, res) => {
  const body = (req.body ?? {}) as { tasklist_id?: string; task_id?: string };
  if (!body.tasklist_id || !body.task_id) {
    res.status(400).json({ error: 'tasklist_id and task_id are required' });
    return;
  }
  const task = await uncompleteTask(body.tasklist_id, body.task_id);
  if (!task) {
    res.status(502).json({ error: 'tasks_api_no_op' });
    return;
  }
  res.json(task);
});

export default router;
