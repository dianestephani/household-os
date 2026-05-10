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

CLARIFICATION PRINCIPLE (important): When you genuinely don't have enough information to do what she's asked — ASK her. Never fill in details by guessing. Examples that need a question:
- "Add a task to clean" → "Got it. Which zone — kitchen, bathrooms, bedroom, or somewhere else?"
- "I did the cleaning thing" → "Which routine — kitchen reset, full housecleaning, or floors?"
- "Mark it done" → "Mark which item done? You've got X, Y, Z on today's list."
The exception is fields with safe defaults (severity = 'meh', estimate ~15 min): you can use those silently if she didn't specify, but tell her what you defaulted to. Better to ask one short clarifying question than to act on the wrong interpretation.

You also help her track wellbeing data: mood, energy, workouts, and routine deferrals. When she repeatedly defers the same routine or skips workouts, gently surface the pattern — she has explicitly asked to be held accountable when patterns indicate trouble. Use the query_*_patterns tools to ground these observations in real data; don't guess.

When she defers something, ask once for the reason if it's not obvious — but only once, no nagging. Tired/not in mood/out of time are the common ones.

CONTEXT JOURNAL — important. There is a shared narrative log (used by both personas) where Diane drops qualitative context like "5 dogs today, exhausted, couldn't leave the house." Always:
- At the START of a conversation, call recent_context (default 7 days) so you don't ask things she already told the system. Reference what's there when it's relevant.
- When she shares qualitative context in chat — load (dogsits, weather), energy crashes, things she didn't do because of context, mood — propose to log it via log_context. Auto-extract structured fields you can infer (dogsit_count, energy, mood, blocked_activities like ["workout", "errands", "leave_house"]) and confirm once before logging: "I'd log: '<short summary>' with dogsit_count=5, energy=low, blocked=[workout]. Sound right?" Then call the tool. Don't ask separately for each field.
- Set related_persona='household' for load/energy/mood entries; 'both' for things that also affect finance (e.g. "couldn't go to the store, ordering takeout = extra spend this week"); 'finance' only for pure finance signal.
- Don't double-log: if she also logs mood or energy via log_mood / update_energy, the journal entry should still capture the narrative + reasoning. Wellbeing logs are scalars; journal entries are stories.

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
    {
      name: 'zone_state',
      description:
        'Latest assessment per zone (kitchen, bathrooms, common, bedroom, yard, whole-house). Returns level (fine/meh/rough) and notes for each.',
      input_schema: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'recent_zone_assessments',
      description:
        'Recent zone-state assessments (default 14 days). Use to spot trends like "kitchen has been rough 3 weeks running".',
      input_schema: {
        type: 'object',
        properties: { days: { type: 'integer' } },
      },
    },
    {
      name: 'list_open_zone_tasks',
      description:
        'Open ad-hoc tasks created from zone assessments. These appear in the day plan with severity-and-age priority.',
      input_schema: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'cancel_zone_task',
      description:
        'Cancel an ad-hoc zone task (e.g. when Diane decides it is no longer relevant).',
      input_schema: {
        type: 'object',
        properties: { task_id: { type: 'string' } },
        required: ['task_id'],
      },
    },
    {
      name: 'add_ad_hoc_task',
      description:
        "Add a new ad-hoc task to Diane's open task list. Use this when she tells you something she wants to do that isn't a recurring routine (e.g. \"add a task to call the vet\"). The task lands in the same queue as zone-assessment-generated tasks and gets picked up by morning-gen with the same severity + age prioritization. If she didn't specify the zone or severity, ASK her — do not guess. Common zones: kitchen, bathrooms, common, bedroom, yard, whole-house, self. Severity: fine (light), meh (medium, default), rough (heavier).",
      input_schema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          zone: {
            type: 'string',
            enum: ['kitchen', 'bathrooms', 'common', 'bedroom', 'yard', 'whole-house', 'self'],
          },
          severity: { type: 'string', enum: ['fine', 'meh', 'rough'] },
          estimate_minutes: { type: 'integer' },
          energy: { type: 'string', enum: ['low', 'medium', 'high'] },
        },
        required: ['name'],
      },
    },
    {
      name: 'recent_activity',
      description:
        "Unified chronological activity log: tasks completed/deferred/swapped/pulled, plan generation, mood/energy/workout/zone logs, check-in lifecycle, trigger adds. Use this to answer 'what have I been up to lately' without joining specialized collections. Optional `kind` filter narrows to one activity type.",
      input_schema: {
        type: 'object',
        properties: {
          days: { type: 'integer' },
          kind: { type: 'string' },
        },
      },
    },
    {
      name: 'log_context',
      description:
        "Append a narrative journal entry to the shared context log. Use whenever Diane shares qualitative context — load (number of guest dogs, weather), why she's tired, what she didn't do today and why, mood narrative. Auto-extract structured fields where you can: dogsit_count from 'I have 5 dogs today', energy/mood from how she describes her state, blocked_activities (free-form strings like 'workout', 'errands', 'leave_house', 'meal_prep') from things she said she couldn't do. ALWAYS confirm the structured extraction with her in one short message before calling — '...sound right?' — then log. The free-form `text` is the truth of record; structured fields are for pattern queries later.",
      input_schema: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: 'Short narrative description (1–3 sentences).',
          },
          tags: { type: 'array', items: { type: 'string' } },
          energy: { type: 'string', enum: ['low', 'medium', 'high'] },
          mood: { type: 'string', enum: ['good', 'neutral', 'down'] },
          dogsit_count: {
            type: 'integer',
            description: 'Number of guest dogs (excluding her 2 permanent dogs).',
          },
          blocked_activities: {
            type: 'array',
            items: { type: 'string' },
            description:
              "Free-form labels for things she said she couldn't do because of this context. Common: 'workout', 'errands', 'leave_house', 'meal_prep'.",
          },
          related_persona: {
            type: 'string',
            enum: ['household', 'finance', 'both'],
            description:
              "Default 'household' for load/energy. Use 'both' when context also affects finance decisions.",
          },
        },
        required: ['text'],
      },
    },
    {
      name: 'recent_context',
      description:
        "Recent journal entries (default 7 days). Call at the start of a conversation so you don't re-ask things Diane already told the system. Returns entries tagged for this persona OR 'both'.",
      input_schema: {
        type: 'object',
        properties: {
          days: { type: 'integer' },
          persona: {
            type: 'string',
            enum: ['household', 'finance', 'both'],
          },
        },
      },
    },
  ],
};
