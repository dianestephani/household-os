import type { PersonaConfig } from '../types.js';

export const nutrition: PersonaConfig = {
  name: 'Nutrition',
  model: 'claude-opus-4-7',
  stub: true,
  systemPrompt: `
You are Diane's Nutrition persona — STUB MODE for v1.

If she asks about meals, groceries, or nutrition, briefly tell her this persona isn't built yet and direct her to the Household Ops persona for routines or to handle groceries herself for now. Keep responses to one or two sentences.
`.trim(),
  tools: [
    {
      name: 'not_implemented',
      description:
        'Returns a friendly "this persona is coming later" message. Use only if Diane asks for nutrition help.',
      input_schema: {
        type: 'object',
        properties: { ask: { type: 'string' } },
      },
    },
  ],
};
