import Anthropic from '@anthropic-ai/sdk';
import { personas } from '@household-os/shared/personas';
import { getToolsForPersona, type ToolImpl } from './tools.js';

/**
 * Lightweight shape covering the bits of the SDK we actually use. Lets tests
 * inject a fake without depending on the full Anthropic class.
 */
export interface AnthropicLike {
  messages: {
    create: (
      body: Anthropic.MessageCreateParamsNonStreaming,
    ) => Promise<Anthropic.Message>;
  };
}

let _defaultClient: AnthropicLike | null = null;
function getDefaultClient(): AnthropicLike {
  if (!_defaultClient) _defaultClient = new Anthropic();
  return _defaultClient;
}

const MAX_ITERATIONS = 8;

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string | Anthropic.ContentBlockParam[];
}

export interface ChatResult {
  reply: string;
  messages: ChatMessage[];
}

function safeStringify(v: unknown): string {
  try {
    return typeof v === 'string' ? v : JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export async function chat(
  personaName: string,
  messages: ChatMessage[],
  client: AnthropicLike = getDefaultClient(),
): Promise<ChatResult> {
  const persona = personas[personaName];
  if (!persona) {
    return {
      reply: `Unknown persona "${personaName}".`,
      messages,
    };
  }

  if (persona.stub) {
    const reply =
      personaName === 'grocery'
        ? "Grocery Manager is launcher-only — open the Food tab in the dashboard and click 'Open in Claude.ai' to chat in your Grocery Manager Claude Project."
        : personaName === 'finance'
          ? 'Finance persona is in stub mode for v1 — RocketMoney is still your source of truth.'
          : 'This persona is in stub mode.';
    return {
      reply,
      messages: [...messages, { role: 'assistant', content: reply }],
    };
  }

  const tools: Anthropic.ToolUnion[] = persona.tools.map((t, i, arr) => {
    const isLast = i === arr.length - 1;
    return {
      name: t.name,
      description: t.description,
      input_schema: t.input_schema as Anthropic.Tool.InputSchema,
      ...(isLast ? { cache_control: { type: 'ephemeral' as const } } : {}),
    };
  });

  const toolImpls: Record<string, ToolImpl> = getToolsForPersona(personaName);

  const conversation: Anthropic.MessageParam[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  let finalText = '';

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await client.messages.create({
      model: persona.model,
      max_tokens: 1024,
      system: [
        {
          type: 'text',
          text: persona.systemPrompt,
          cache_control: { type: 'ephemeral' },
        },
      ],
      tools,
      messages: conversation,
    });

    conversation.push({ role: 'assistant', content: response.content });

    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    );

    if (response.stop_reason === 'end_turn' || toolUses.length === 0) {
      for (const block of response.content) {
        if (block.type === 'text') finalText += block.text;
      }
      break;
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      const impl = toolImpls[tu.name];
      let result: unknown;
      let isError = false;
      try {
        result = impl
          ? await impl((tu.input as Record<string, unknown>) ?? {})
          : { error: `unknown tool ${tu.name}` };
      } catch (err) {
        isError = true;
        result = { error: err instanceof Error ? err.message : String(err) };
      }
      toolResults.push({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: safeStringify(result),
        is_error: isError,
      });
    }

    conversation.push({ role: 'user', content: toolResults });
  }

  return {
    reply: finalText.trim(),
    messages: [
      ...messages,
      { role: 'assistant', content: finalText.trim() },
    ],
  };
}
