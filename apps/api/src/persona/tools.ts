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
import {
  cancelAdHocTask,
  createAdHocTask,
  latestAssessmentByZone,
  listOpenAdHocTasks,
  listRecentAssessments,
} from '../services/zones.js';
import { recentActivity } from '../services/activity.js';
import {
  affordabilityReport,
  estimateMonthlyTax,
  getFinancialProfile,
  listOutsourceable,
  setFinancialProfile,
} from '../services/finance.js';
import { addContext, recentContext } from '../services/context.js';
import type { ActivityKind, FilingStatus } from '@household-os/shared/types';
import type {
  ContextRelatedPersona,
  DeferReasonCode,
  EnergyLevel,
  MoodLevel,
  Zone,
  ZoneStateLevel,
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

  zone_state: async () => latestAssessmentByZone(),

  recent_zone_assessments: async (input) =>
    listRecentAssessments((input.days as number | undefined) ?? 14),

  list_open_zone_tasks: async () => listOpenAdHocTasks(),

  cancel_zone_task: async (input) =>
    cancelAdHocTask(input.task_id as string),

  add_ad_hoc_task: async (input) =>
    createAdHocTask({
      name: input.name as string,
      zone: input.zone as Zone | undefined,
      severity: input.severity as ZoneStateLevel | undefined,
      estimate_minutes: input.estimate_minutes as number | undefined,
      energy: input.energy as EnergyLevel | undefined,
      source: (input.source as string | undefined) ?? 'persona',
    }),

  recent_activity: async (input) =>
    recentActivity(
      (input.days as number | undefined) ?? 7,
      input.kind as ActivityKind | undefined,
    ),

  log_context: async (input) =>
    addContext({
      text: input.text as string,
      tags: input.tags as string[] | undefined,
      energy: input.energy as EnergyLevel | undefined,
      mood: input.mood as MoodLevel | undefined,
      dogsit_count: input.dogsit_count as number | undefined,
      blocked_activities: input.blocked_activities as string[] | undefined,
      related_persona:
        (input.related_persona as ContextRelatedPersona | undefined) ?? 'household',
      source: 'persona',
    }),

  recent_context: async (input) =>
    recentContext(
      (input.days as number | undefined) ?? 7,
      (input.persona as ContextRelatedPersona | undefined) ?? 'household',
    ),
};

export const financeTools: Record<string, ToolImpl> = {
  get_financial_profile: async () => getFinancialProfile(),

  set_financial_profile: async (input) =>
    setFinancialProfile({
      monthly_gross_income: input.monthly_gross_income as number | undefined,
      monthly_tax_estimate: input.monthly_tax_estimate as number | undefined,
      monthly_fixed_expenses: input.monthly_fixed_expenses as number | undefined,
      state: input.state as string | undefined,
      filing_status: input.filing_status as FilingStatus | undefined,
      monthly_extra_withholding:
        input.monthly_extra_withholding as number | undefined,
      notes: input.notes as string | undefined,
      expense_breakdown: input.expense_breakdown as string | undefined,
    }),

  estimate_tax: async (input) =>
    estimateMonthlyTax({
      monthly_gross_income: (input.monthly_gross_income as number) ?? 0,
      state: input.state as string | undefined,
      filing_status: input.filing_status as FilingStatus | undefined,
      monthly_extra_withholding:
        input.monthly_extra_withholding as number | undefined,
    }),

  list_outsourceable_routines: async () => listOutsourceable(),

  affordability_report: async () => affordabilityReport(),

  edit_routine_outsourcing: async (input) =>
    patchRoutine(input.routine_key as string, {
      outsourceable: input.outsourceable as boolean | undefined,
      outsource_cost_estimate: input.outsource_cost_estimate as
        | number
        | undefined,
    }),

  log_context: async (input) =>
    addContext({
      text: input.text as string,
      tags: input.tags as string[] | undefined,
      energy: input.energy as EnergyLevel | undefined,
      mood: input.mood as MoodLevel | undefined,
      dogsit_count: input.dogsit_count as number | undefined,
      blocked_activities: input.blocked_activities as string[] | undefined,
      related_persona:
        (input.related_persona as ContextRelatedPersona | undefined) ?? 'finance',
      source: 'persona',
    }),

  recent_context: async (input) =>
    recentContext(
      (input.days as number | undefined) ?? 14,
      (input.persona as ContextRelatedPersona | undefined) ?? 'finance',
    ),
};

export const stubTools: Record<string, ToolImpl> = {
  not_implemented: async () => ({
    message:
      "This persona isn't built yet. Diane is starting with Household Ops; nutrition comes later.",
  }),
};

export function getToolsForPersona(name: string): Record<string, ToolImpl> {
  if (name === 'household') return householdTools;
  if (name === 'finance') return financeTools;
  return stubTools;
}
