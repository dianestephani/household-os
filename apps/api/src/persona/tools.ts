import {
  getToday,
  swapTask,
  pullFromPool,
  markDone,
} from '../services/today.js';
import { logEnergy, suggestSwaps } from '../services/energy.js';
import { logMood } from '../services/mood.js';
import { listRoutines, patchRoutine } from '../services/routines.js';
import { addTrigger } from '../services/triggers.js';
import {
  logWorkout,
  recentWorkouts,
  todaysWorkout,
} from '../services/workouts.js';
import { frequentDeferrals, workoutSummary } from '../services/patterns.js';
import {
  listPendingCheckIns,
  recentCheckIns,
} from '../services/checkins.js';
import type {
  DeferReasonCode,
  EnergyLevel,
  MoodLevel,
  TriggerType,
  WorkoutSlotKey,
  WorkoutStatus,
} from '@household-os/shared/types';

export type ToolImpl = (input: Record<string, unknown>) => Promise<unknown>;

export const householdTools: Record<string, ToolImpl> = {
  get_today: async () => getToday(),

  list_routines: async (input) =>
    listRoutines({
      category: input.category as string | undefined,
      zone: input.zone as string | undefined,
    }),

  swap_task: async (input) =>
    swapTask(
      input.item_key as string,
      input.replacement_key as string | undefined,
      input.reason as DeferReasonCode | undefined,
      input.notes as string | undefined,
    ),

  pull_from_pool: async (input) => pullFromPool(input.item_key as string),

  mark_done: async (input) => markDone(input.item_key as string),

  update_energy: async (input) => {
    const level = input.level as EnergyLevel;
    await logEnergy(level, 'voice');
    return suggestSwaps(level);
  },

  edit_routine: async (input) =>
    patchRoutine(
      input.key as string,
      (input.patch as Record<string, unknown>) ?? {},
    ),

  add_trigger: async (input) =>
    addTrigger({
      type: input.type as TriggerType,
      date: input.date as string,
      notes: input.notes as string | undefined,
    }),

  log_mood: async (input) => logMood((input.level as MoodLevel) ?? 'neutral', 'voice'),

  log_workout: async (input) =>
    logWorkout({
      slot_key: (input.slot_key as WorkoutSlotKey) ?? 'ad_hoc',
      status: (input.status as WorkoutStatus) ?? 'done',
      notes: input.notes as string | undefined,
      mood: input.mood as MoodLevel | undefined,
      energy: input.energy as EnergyLevel | undefined,
    }),

  todays_workout: async () => todaysWorkout(),

  recent_workouts: async (input) =>
    recentWorkouts((input.days as number | undefined) ?? 14),

  query_deferral_patterns: async (input) =>
    frequentDeferrals(
      (input.days as number | undefined) ?? 14,
      (input.min as number | undefined) ?? 2,
    ),

  query_workout_patterns: async (input) =>
    workoutSummary((input.days as number | undefined) ?? 14),

  list_pending_checkins: async () => listPendingCheckIns(),

  recent_checkins: async (input) =>
    recentCheckIns((input.days as number | undefined) ?? 14),
};

export const stubTools: Record<string, ToolImpl> = {
  not_implemented: async () => ({
    message:
      "This persona isn't built yet. Diane is starting with Household Ops; nutrition and finance come later.",
  }),
};

export function getToolsForPersona(name: string): Record<string, ToolImpl> {
  if (name === 'household') return householdTools;
  return stubTools;
}
