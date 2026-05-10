import type { tasks_v1 } from 'googleapis';
import {
  isTasksConnected,
  listAllTasks,
  patchTaskStatus,
} from '../utils/google-tasks.js';
import { ymd } from '../utils/dates.js';
import type { CalendarTask } from '@household-os/shared/types';

/**
 * Convert a raw Google Tasks task to our normalized shape. Returns null when
 * required bits (id, title) are missing. We keep `tasklist_id` because the
 * Tasks API requires it to mutate the task (mark-complete).
 */
export function normalizeTask(
  tasklistId: string,
  task: tasks_v1.Schema$Task,
): CalendarTask | null {
  if (!task.id || !task.title) return null;
  const status =
    task.status === 'completed' ? 'completed' : 'needsAction';
  return {
    id: task.id,
    tasklist_id: tasklistId,
    title: task.title,
    notes: task.notes ?? undefined,
    due: task.due ?? undefined,
    status,
    completed: task.completed ?? undefined,
  };
}

/**
 * The Tasks API `due` is stored as date-only at UTC midnight. We compare its
 * `YYYY-MM-DD` prefix against the dashboard's local-day string. Tasks with no
 * `due` are excluded from per-day views (treat them as backlog).
 */
export function taskDueOn(task: CalendarTask, dateStr: string): boolean {
  if (!task.due) return false;
  return task.due.slice(0, 10) === dateStr;
}

export async function tasksForDay(dateStr: string): Promise<CalendarTask[]> {
  if (!isTasksConnected()) return [];
  const raw = await listAllTasks();
  return raw
    .map((r) => normalizeTask(r.tasklistId, r.task))
    .filter((t): t is CalendarTask => t !== null && taskDueOn(t, dateStr));
}

export async function tasksWithoutDueDate(): Promise<CalendarTask[]> {
  if (!isTasksConnected()) return [];
  const raw = await listAllTasks();
  return raw
    .map((r) => normalizeTask(r.tasklistId, r.task))
    .filter(
      (t): t is CalendarTask =>
        t !== null && !t.due && t.status === 'needsAction',
    );
}

export async function completeTask(
  tasklistId: string,
  taskId: string,
): Promise<CalendarTask | null> {
  const raw = await patchTaskStatus(tasklistId, taskId, 'completed');
  if (!raw) return null;
  return normalizeTask(tasklistId, raw);
}

export async function uncompleteTask(
  tasklistId: string,
  taskId: string,
): Promise<CalendarTask | null> {
  const raw = await patchTaskStatus(tasklistId, taskId, 'needsAction');
  if (!raw) return null;
  return normalizeTask(tasklistId, raw);
}

/** Convenience: today's tasks (in the caller's local timezone). */
export async function todaysTasks(): Promise<CalendarTask[]> {
  return tasksForDay(ymd(new Date()));
}
