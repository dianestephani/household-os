import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  getToday,
  swapTask,
  markDone,
} from '../services/today.js';
import { logEnergy, suggestSwaps } from '../services/energy.js';
import { logMood } from '../services/mood.js';
import { logWorkout } from '../services/workouts.js';
import { addContext, recentContext } from '../services/context.js';
import { createAdHocTask, listOpenAdHocTasks } from '../services/zones.js';
import { recentActivity } from '../services/activity.js';
import type {
  DeferReasonCode,
  EnergyLevel,
  MoodLevel,
  WorkoutSlotKey,
  WorkoutStatus,
  Zone,
  ZoneStateLevel,
} from '@household-os/shared/types';

/**
 * MCP (Model Context Protocol) server exposing a focused subset of household
 * tools to remote MCP clients — primarily Claude.ai's Custom Connectors UI.
 *
 * Tool selection is intentionally narrower than the full persona-tool
 * catalogue: just what Diane needs to "tell Claude.ai what I did today or
 * what I want to add." Read tools are included to ground responses
 * (`get_today`, `recent_activity`, `recent_context`, `list_open_zone_tasks`).
 *
 * Tools call the same service-layer functions the Anthropic-API persona path
 * uses, so behavior stays identical regardless of which surface invoked it.
 * Source tags ('mcp' on writes) let the activity log distinguish provenance.
 */

const ZONE_VALUES = [
  'kitchen',
  'bathrooms',
  'common',
  'bedroom',
  'yard',
  'whole-house',
  'self',
] as const;

const SEVERITY_VALUES = ['fine', 'meh', 'rough'] as const;
const ENERGY_VALUES = ['low', 'medium', 'high'] as const;
const MOOD_VALUES = ['good', 'neutral', 'down'] as const;
const WORKOUT_STATUS_VALUES = ['done', 'skipped', 'partial'] as const;
const WORKOUT_SLOT_VALUES = [
  'pt_tue',
  'pt_thu',
  'lift_flex',
  'ad_hoc',
] as const;
const DEFER_REASON_VALUES = [
  'tired',
  'not_in_mood',
  'out_of_time',
  'over_budget',
  'manual_swap',
  'energy_drop',
  'other',
] as const;

function asText(payload: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2),
      },
    ],
  };
}

export function buildMcpServer(): McpServer {
  const server = new McpServer({
    name: 'household-os',
    version: '0.1.0',
  });

  // ---------- Write tools ----------

  server.registerTool(
    'add_ad_hoc_task',
    {
      description:
        "Add a new ad-hoc task to Diane's open task list. New tasks slot into morning-gen's severity + age prioritization. If zone/severity aren't specified, the tool uses sensible defaults (zone='whole-house', severity='meh'). For ambiguous tasks, ASK the user for zone/severity before calling rather than guessing.",
      inputSchema: {
        name: z.string().min(1),
        zone: z.enum(ZONE_VALUES).optional(),
        severity: z.enum(SEVERITY_VALUES).optional(),
        estimate_minutes: z.number().int().positive().optional(),
        energy: z.enum(ENERGY_VALUES).optional(),
      },
    },
    async (args) => {
      const task = await createAdHocTask({
        name: args.name,
        zone: args.zone as Zone | undefined,
        severity: args.severity as ZoneStateLevel | undefined,
        estimate_minutes: args.estimate_minutes,
        energy: args.energy as EnergyLevel | undefined,
        source: 'mcp',
      });
      return asText({ ok: true, task });
    },
  );

  server.registerTool(
    'mark_done',
    {
      description:
        "Mark an item on today's plan complete by its routine key. Use after Diane tells you she did something. If she names the routine ambiguously, look up `get_today` first and confirm which item she means.",
      inputSchema: { item_key: z.string().min(1) },
    },
    async ({ item_key }) => asText(await markDone(item_key)),
  );

  server.registerTool(
    'swap_task',
    {
      description:
        "Defer an item out of today's plan (to swap_pool). Optionally bring a replacement in. Use when Diane wants to push something later or swap it for a different item.",
      inputSchema: {
        item_key: z.string().min(1),
        replacement_key: z.string().optional(),
        reason: z.enum(DEFER_REASON_VALUES).optional(),
        notes: z.string().optional(),
      },
    },
    async (args) =>
      asText(
        await swapTask(
          args.item_key,
          args.replacement_key,
          args.reason as DeferReasonCode | undefined,
          args.notes,
        ),
      ),
  );

  server.registerTool(
    'update_energy',
    {
      description:
        "Set Diane's current energy level (low / medium / high). Returns suggested swaps from morning-gen given the new level. Does not auto-apply — caller confirms each swap with the user.",
      inputSchema: { level: z.enum(ENERGY_VALUES) },
    },
    async ({ level }) => {
      await logEnergy(level as EnergyLevel, 'voice');
      return asText(await suggestSwaps(level as EnergyLevel));
    },
  );

  server.registerTool(
    'log_mood',
    {
      description:
        "Log Diane's current mood. Use when she mentions how she's feeling.",
      inputSchema: { level: z.enum(MOOD_VALUES) },
    },
    async ({ level }) =>
      asText(await logMood(level as MoodLevel, 'voice')),
  );

  server.registerTool(
    'log_workout',
    {
      description:
        "Record a workout's status. slot_key = pt_tue / pt_thu / lift_flex / ad_hoc; status = done / skipped / partial.",
      inputSchema: {
        slot_key: z.enum(WORKOUT_SLOT_VALUES),
        status: z.enum(WORKOUT_STATUS_VALUES),
        notes: z.string().optional(),
        mood: z.enum(MOOD_VALUES).optional(),
        energy: z.enum(ENERGY_VALUES).optional(),
      },
    },
    async (args) =>
      asText(
        await logWorkout({
          slot_key: args.slot_key as WorkoutSlotKey,
          status: args.status as WorkoutStatus,
          notes: args.notes,
          mood: args.mood as MoodLevel | undefined,
          energy: args.energy as EnergyLevel | undefined,
        }),
      ),
  );

  server.registerTool(
    'log_context',
    {
      description:
        "Append a narrative journal entry to Diane's shared context log. Use when she shares qualitative context — load (dogsit_count), energy crashes, things she didn't do and why, mood. Auto-extract structured fields you can infer, but confirm once with her before logging.",
      inputSchema: {
        text: z.string().min(1),
        tags: z.array(z.string()).optional(),
        energy: z.enum(ENERGY_VALUES).optional(),
        mood: z.enum(MOOD_VALUES).optional(),
        dogsit_count: z.number().int().nonnegative().optional(),
        blocked_activities: z.array(z.string()).optional(),
        related_persona: z.enum(['household', 'finance', 'both']).optional(),
      },
    },
    async (args) =>
      asText(
        await addContext({
          text: args.text,
          tags: args.tags,
          energy: args.energy as EnergyLevel | undefined,
          mood: args.mood as MoodLevel | undefined,
          dogsit_count: args.dogsit_count,
          blocked_activities: args.blocked_activities,
          related_persona: args.related_persona ?? 'household',
          source: 'persona',
        }),
      ),
  );

  // ---------- Read tools ----------

  server.registerTool(
    'get_today',
    {
      description:
        "Return today's plan (items, swap pool, current energy, budget). Call first when Diane references 'what's on today' or before any action that depends on knowing the plan.",
      inputSchema: {},
    },
    async () => asText(await getToday()),
  );

  server.registerTool(
    'recent_activity',
    {
      description:
        "Recent chronological activity log: tasks done/deferred/swapped, mood/energy/workout logs, plan generation, context entries. Use to answer 'what have I done lately'.",
      inputSchema: {
        days: z.number().int().positive().max(60).optional(),
      },
    },
    async ({ days }) => asText(await recentActivity(days ?? 7)),
  );

  server.registerTool(
    'recent_context',
    {
      description:
        "Recent journal entries (default 7 days). Call at the start of a conversation to ground responses in qualitative context Diane already shared.",
      inputSchema: {
        days: z.number().int().positive().max(60).optional(),
      },
    },
    async ({ days }) =>
      asText(await recentContext(days ?? 7, 'household')),
  );

  server.registerTool(
    'list_open_zone_tasks',
    {
      description:
        "List ad-hoc tasks currently in the queue (status='open'). Use before adding a new task to avoid duplicates.",
      inputSchema: {},
    },
    async () => asText(await listOpenAdHocTasks()),
  );

  return server;
}
