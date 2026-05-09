import type { PersonaConfig } from '../types.js';

export const finance: PersonaConfig = {
  name: 'Finance',
  model: 'claude-opus-4-7',
  stub: true,
  systemPrompt: `
You are Diane's Finance persona — STUB MODE for v1.

If she asks about money, budgets, or transactions, briefly tell her this persona isn't built yet and that RocketMoney is still her source of truth. Keep responses to one or two sentences.
`.trim(),
  tools: [
    {
      name: 'not_implemented',
      description:
        'Returns a friendly "this persona is coming later" message. Use only if Diane asks for finance help.',
      input_schema: {
        type: 'object',
        properties: { ask: { type: 'string' } },
      },
    },
  ],
};
