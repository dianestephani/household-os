import { listRoutines, patchRoutine, createRoutine, softDeleteRoutine } from '../services/routines.js';
import { logWorkout, recentWorkouts } from '../services/workouts.js';
import {
  affordabilityReport,
  estimateMonthlyTax,
  getFinancialProfile,
  listOutsourceable,
} from '../services/finance.js';
import { todaysEvents } from '../services/calendar.js';
import { scheduleRange } from '../services/schedule.js';
import { addImport, listImports } from '../services/finance-history.js';
import type {
  EnergyLevel,
  FilingStatus,
  MoodLevel,
  WorkoutSlotKey,
  WorkoutStatus,
} from '@household-os/shared/types';

/**
 * Tool impls for the unified assistant (§50 Phase A). Maps the 14 tool names
 * declared in `@household-os/shared/persona/assistant` onto the existing
 * service layer. Phase B/E add the deferred tools (morning-checkin,
 * cadence-shift, projected income, calendar event CRUD) — they don't appear
 * here yet because their underlying services don't exist.
 */

export type ToolImpl = (input: Record<string, unknown>) => Promise<unknown>;

export const assistantTools: Record<string, ToolImpl> = {
  get_calendar_today: async () => todaysEvents(),

  get_calendar_range: async (input) => {
    const days = Number((input.days as number | undefined) ?? 7);
    const safe = Number.isFinite(days) ? days : 7;
    return scheduleRange(new Date(), safe);
  },

  list_routines: async (input) =>
    listRoutines({
      category: input.category as string | undefined,
      // `active` filter is documented but `listRoutines` currently defaults to
      // active=true; passing false to opt out is a Phase E follow-up. For now
      // we just forward the category.
    }),

  create_routine: async (input) => {
    const key = (input.key as string | undefined)?.trim();
    const name = (input.name as string | undefined)?.trim();
    if (!key) throw new Error('create_routine requires `key`');
    if (!name) throw new Error('create_routine requires `name`');

    const scheduling = (input.scheduling as Record<string, unknown> | undefined) ?? {
      type: 'rolling',
    };

    const doc: Record<string, unknown> = {
      key,
      name,
      category: input.category ?? 'personal',
      zone: input.zone ?? 'whole-house',
      scheduling,
      estimate_minutes: input.estimate_minutes ?? 15,
      energy: input.energy ?? 'medium',
      active: true,
    };
    if (input.outsourceable !== undefined) doc.outsourceable = input.outsourceable;
    if (input.outsource_cost_estimate !== undefined) {
      doc.outsource_cost_estimate = input.outsource_cost_estimate;
    }
    if (input.notes !== undefined) doc.notes = input.notes;
    return createRoutine(doc);
  },

  update_routine: async (input) => {
    const key = input.key as string | undefined;
    if (!key) throw new Error('update_routine requires `key`');
    const patch = (input.patch as Record<string, unknown> | undefined) ?? {};
    return patchRoutine(key, patch);
  },

  delete_routine: async (input) => {
    const key = input.key as string | undefined;
    if (!key) throw new Error('delete_routine requires `key`');
    return softDeleteRoutine(key);
  },

  log_workout: async (input) =>
    logWorkout({
      slot_key: (input.slot_key as WorkoutSlotKey) ?? 'ad_hoc',
      status: (input.status as WorkoutStatus) ?? 'done',
      notes: input.notes as string | undefined,
      mood: input.mood as MoodLevel | undefined,
      energy: input.energy as EnergyLevel | undefined,
    }),

  recent_workouts: async (input) =>
    recentWorkouts((input.days as number | undefined) ?? 14),

  get_financial_profile: async () => getFinancialProfile(),

  estimate_tax: async (input) =>
    estimateMonthlyTax({
      monthly_gross_income: (input.monthly_gross_income as number) ?? 0,
      state: input.state as string | undefined,
      filing_status: input.filing_status as FilingStatus | undefined,
      monthly_extra_withholding:
        input.monthly_extra_withholding as number | undefined,
    }),

  affordability_report: async () => affordabilityReport(),

  list_outsourceable: async () => listOutsourceable(),

  recent_imports: async (input) => {
    const limit = Number((input.limit as number | undefined) ?? 10);
    return listImports(Number.isFinite(limit) ? limit : 10);
  },

  add_rocketmoney_paste: async (input) => {
    const text = (input.text as string | undefined)?.trim();
    if (!text) throw new Error('add_rocketmoney_paste requires `text`');
    return addImport({ kind: 'paste', raw: text });
  },
};
