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
        'Move an item out of today (to swap_pool) and optionally bring a replacement in.',
      input_schema: {
        type: 'object',
        properties: {
          item_key: { type: 'string' },
          replacement_key: { type: 'string' },
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
  ],
};
