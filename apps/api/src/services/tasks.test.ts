import { describe, it, expect } from 'vitest';
import type { tasks_v1 } from 'googleapis';
import {
  completeTask,
  normalizeTask,
  taskDueOn,
  tasksForDay,
  todaysTasks,
  uncompleteTask,
} from './tasks.js';

describe('normalizeTask', () => {
  it('shapes a needsAction task with notes + due', () => {
    const raw = {
      id: 'abc',
      title: 'Pick up dry cleaning',
      notes: 'On 14th',
      due: '2026-05-12T00:00:00.000Z',
      status: 'needsAction',
    };
    expect(normalizeTask('list-1', raw)).toEqual({
      id: 'abc',
      tasklist_id: 'list-1',
      title: 'Pick up dry cleaning',
      notes: 'On 14th',
      due: '2026-05-12T00:00:00.000Z',
      status: 'needsAction',
      completed: undefined,
    });
  });

  it('treats anything not exactly "completed" as needsAction', () => {
    const raw = { id: 'a', title: 't', status: 'unknown' };
    expect(normalizeTask('list', raw)?.status).toBe('needsAction');
  });

  it('returns null when id or title is missing', () => {
    expect(
      normalizeTask('list', { title: 'no-id', status: 'needsAction' }),
    ).toBeNull();
    expect(
      normalizeTask('list', { id: 'no-title', status: 'needsAction' }),
    ).toBeNull();
  });

  it('preserves the completed timestamp on completed tasks', () => {
    const raw = {
      id: 'a',
      title: 't',
      status: 'completed',
      completed: '2026-05-10T15:00:00.000Z',
    };
    expect(normalizeTask('list', raw)?.completed).toBe(
      '2026-05-10T15:00:00.000Z',
    );
  });
});

describe('taskDueOn', () => {
  it('matches a task whose RFC 3339 due-date prefix is the day', () => {
    const task = normalizeTask('list', {
      id: 'a',
      title: 't',
      status: 'needsAction',
      due: '2026-05-12T00:00:00.000Z',
    } as tasks_v1.Schema$Task);
    expect(taskDueOn(task!, '2026-05-12')).toBe(true);
    expect(taskDueOn(task!, '2026-05-13')).toBe(false);
  });

  it('returns false for tasks with no due date', () => {
    const task = normalizeTask('list', {
      id: 'a',
      title: 't',
      status: 'needsAction',
    } as tasks_v1.Schema$Task);
    expect(taskDueOn(task!, '2026-05-12')).toBe(false);
  });
});

describe('tasksForDay / todaysTasks — disconnected (test mode)', () => {
  // The NODE_ENV=test guard in utils/google-tasks short-circuits any real
  // API call. Service-level wrappers return [] in that state, which is the
  // behavior we contractually expect on deployments without OAuth.
  it('returns empty when tasks API is not connected', async () => {
    expect(await tasksForDay('2026-05-12')).toEqual([]);
    expect(await todaysTasks()).toEqual([]);
  });

  it('completeTask / uncompleteTask return null when disconnected', async () => {
    expect(await completeTask('list', 'task')).toBeNull();
    expect(await uncompleteTask('list', 'task')).toBeNull();
  });
});
