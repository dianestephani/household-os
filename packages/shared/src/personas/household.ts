import type { PersonaConfig } from '../types.js';

export const household: PersonaConfig = {
  name: 'Household Ops',
  model: 'claude-opus-4-7',
  systemPrompt: `
You are Diane's Household Ops assistant. She is 34, rents a 3BR with 2 cats and 2 dogs, Airbnbs spare rooms, dogsits often, and works catering gigs on weekends. She has a hyperfixate-burnout pattern with side projects, so prefer simple, low-maintenance suggestions over elaborate systems.

Your job:
- Help her view, edit, and reason about her household routines and today's plan.
- When she asks for changes, use tools — don't just describe what you'd do.
- For energy-driven swaps: ALWAYS confirm before applying. Suggest the change, wait for "yes" or equivalent, then call the tool.
- Be concise. Casual tone. No bullet-list-of-everything dumps unless asked.
- Voice (Alexa) responses must be ≤2 sentences. Dashboard responses can be longer but stay tight.

You also help her track wellbeing data: mood, energy, workouts, and routine deferrals. When she repeatedly defers the same routine or skips workouts, gently surface the pattern — she has explicitly asked to be held accountable when patterns indicate trouble. Use the query_*_patterns tools to ground these observations in real data; don't guess.

When she defers something, ask once for the reason if it's not obvious — but only once, no nagging. Tired/not in mood/out of time are the common ones.

You do NOT handle nutrition/groceries or finance — direct her to those personas if asked.
`.trim(),
  tools: [
    {
      name: 'get_today',
      description:
        'Get the current TodayPlan including items, swap_pool, energy, and budget.',
      input_schema: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'list_routines',
      description:
        'List all routines, optionally filtered by category or zone.',
      input_schema: {
        type: 'object',
        properties: {
          category: { type: 'string' },
          zone: { type: 'string' },
        },
      },
    },
    {
      name: 'swap_task',
      description:
        'Move an item out of today (to swap_pool) and optionally bring a replacement in. Pass a reason when known.',
      input_schema: {
        type: 'object',
        properties: {
          item_key: { type: 'string' },
          replacement_key: { type: 'string' },
          reason: {
            type: 'string',
            enum: [
              'tired',
              'not_in_mood',
              'out_of_time',
              'over_budget',
              'manual_swap',
              'energy_drop',
              'other',
            ],
          },
          notes: { type: 'string' },
        },
        required: ['item_key'],
      },
    },
    {
      name: 'pull_from_pool',
      description: 'Bring an item from swap_pool back into today.',
      input_schema: {
        type: 'object',
        properties: { item_key: { type: 'string' } },
        required: ['item_key'],
      },
    },
    {
      name: 'mark_done',
      description:
        "Mark today's item complete and bump the routine's last_done.",
      input_schema: {
        type: 'object',
        properties: { item_key: { type: 'string' } },
        required: ['item_key'],
      },
    },
    {
      name: 'update_energy',
      description:
        'Update current energy and get suggested swaps. Does not mutate plan.',
      input_schema: {
        type: 'object',
        properties: { level: { type: 'string', enum: ['low', 'medium', 'high'] } },
        required: ['level'],
      },
    },
    {
      name: 'edit_routine',
      description:
        "Patch a routine's cadence, estimate, energy, or active flag.",
      input_schema: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          patch: { type: 'object' },
        },
        required: ['key', 'patch'],
      },
    },
    {
      name: 'add_trigger',
      description:
        'Manually add a Trigger (Airbnb, dogsit, landscaper, cleaner_visit).',
      input_schema: {
        type: 'object',
        properties: {
          type: { type: 'string' },
          date: { type: 'string', description: 'YYYY-MM-DD' },
          notes: { type: 'string' },
        },
        required: ['type', 'date'],
      },
    },
    {
      name: 'log_mood',
      description:
        "Log Diane's current mood. Use when she mentions how she's feeling (e.g. 'I'm feeling kinda down today').",
      input_schema: {
        type: 'object',
        properties: {
          level: { type: 'string', enum: ['good', 'neutral', 'down'] },
        },
        required: ['level'],
      },
    },
    {
      name: 'todays_workout',
      description:
        'Get the protected workout slot scheduled for today (if any) and any existing log entry.',
      input_schema: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'log_workout',
      description:
        "Record today's workout status. slot_key is pt_tue / pt_thu / lift_flex / ad_hoc.",
      input_schema: {
        type: 'object',
        properties: {
          slot_key: {
            type: 'string',
            enum: ['pt_tue', 'pt_thu', 'lift_flex', 'ad_hoc'],
          },
          status: { type: 'string', enum: ['done', 'skipped', 'partial'] },
          notes: { type: 'string' },
          mood: { type: 'string', enum: ['good', 'neutral', 'down'] },
          energy: { type: 'string', enum: ['low', 'medium', 'high'] },
        },
        required: ['slot_key', 'status'],
      },
    },
    {
      name: 'recent_workouts',
      description: 'List recent workout logs (default last 14 days).',
      input_schema: {
        type: 'object',
        properties: { days: { type: 'integer' } },
      },
    },
    {
      name: 'query_deferral_patterns',
      description:
        'Find routines that have been deferred at least `min` times in the last `days` (defaults: days=14, min=2). Use this to ground accountability observations in real data.',
      input_schema: {
        type: 'object',
        properties: {
          days: { type: 'integer' },
          min: { type: 'integer' },
        },
      },
    },
    {
      name: 'query_workout_patterns',
      description:
        'Workout completion summary over the last `days` (default 14). Returns scheduled / done / skipped / partial counts and recent streaks.',
      input_schema: {
        type: 'object',
        properties: { days: { type: 'integer' } },
      },
    },
    {
      name: 'list_pending_checkins',
      description:
        'List currently-pending check-ins (morning intent, evening retro, weekly review, pattern interrupts). Useful for grounding follow-up questions in real prompts Diane has been ignoring.',
      input_schema: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'recent_checkins',
      description:
        'Recent check-in history (default 14 days). Includes answered, skipped, and expired prompts and her free-text answers — use to ground observations about how she has been feeling or what she said yesterday.',
      input_schema: {
        type: 'object',
        properties: { days: { type: 'integer' } },
      },
    },
  ],
};
