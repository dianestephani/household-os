import {
  getToday,
  swapTask,
  pullFromPool,
  markDone,
} from '../services/today.js';
import { logEnergy, suggestSwaps } from '../services/energy.js';
import { listRoutines, patchRoutine } from '../services/routines.js';
import { addTrigger } from '../services/triggers.js';
import type {
  EnergyLevel,
  TriggerType,
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
