import Anthropic from '@anthropic-ai/sdk';
import {
  ASSISTANT_TOOLS,
  ASSISTANT_MODEL,
} from '@household-os/shared/persona/assistant';
import { assistantTools, type ToolImpl } from './assistant-tools.js';
import { getCurrent } from '../services/assistant-settings.js';

/**
 * Unified assistant tool-use loop. §50 Phase A — replaces the per-persona
 * runner from §47 Phase 1.
 *
 * Prompt caching is enabled on the system prompt + tool definitions via
 * `cache_control: { type: 'ephemeral' }`, hitting the Anthropic beta endpoint
 * (`anthropic-beta: prompt-caching-2024-07-31` is set by the SDK's
 * `client.beta.promptCaching` path). The system prompt + tool list are both
 * stable across turns, so caching saves ~90% of the input cost.
 *
 * `assistantChat({messages})` returns the assistant's final assistant-role
 * message content blocks (mostly text). The route layer formats it.
 */

export interface ChatRequestMessage {
  role: 'user' | 'assistant';
  content: string | unknown;
}

export interface ChatResult {
  /** Trimmed plain-text reply, concatenating all final-turn text blocks. */
  text: string;
  /** Full content blocks from the final turn (text + any tool_use traces). */
  blocks: unknown[];
  /** Number of tool_use → tool_result round trips. */
  tool_rounds: number;
  /** Token usage on the final turn (input/output/cache). */
  usage?: Record<string, number | undefined>;
  /**
   * Whether the chat actually hit the Anthropic API. False when
   * ANTHROPIC_API_KEY is missing (test mode + un-bootstrapped local dev).
   */
  live: boolean;
}

const MAX_TOOL_ROUNDS = 6;
const MAX_TOKENS = 1024;

let cachedClient: Anthropic | null = null;
let clientOverridden = false;
function getClient(): Anthropic | null {
  // Test hooks always win — runner.test.ts injects a stub via __setAnthropicClient.
  if (clientOverridden) return cachedClient;
  if (process.env.NODE_ENV === 'test') return null;
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (cachedClient) return cachedClient;
  cachedClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return cachedClient;
}

/**
 * Mostly for tests: lets us swap a stub client in without touching env vars.
 * Pass `null` to clear the override and fall back to the env-driven client.
 */
export function __setAnthropicClient(client: Anthropic | null): void {
  cachedClient = client;
  clientOverridden = client !== null;
}

/**
 * Mostly for tests: lets us replace the tool impl table without touching
 * module state from outside this module.
 */
let toolImplOverride: Record<string, ToolImpl> | null = null;
export function __setAssistantTools(impls: Record<string, ToolImpl> | null): void {
  toolImplOverride = impls;
}

function currentTools(): Record<string, ToolImpl> {
  return toolImplOverride ?? assistantTools;
}

function extractText(blocks: unknown[]): string {
  const out: string[] = [];
  for (const b of blocks) {
    if (
      b &&
      typeof b === 'object' &&
      (b as { type?: string }).type === 'text' &&
      typeof (b as { text?: string }).text === 'string'
    ) {
      out.push((b as { text: string }).text);
    }
  }
  return out.join('\n').trim();
}

interface RawToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

function toolUseBlocks(blocks: unknown[]): RawToolUseBlock[] {
  return blocks.filter(
    (b): b is RawToolUseBlock =>
      !!b &&
      typeof b === 'object' &&
      (b as { type?: string }).type === 'tool_use',
  );
}

export async function assistantChat({
  messages,
}: {
  messages: ChatRequestMessage[];
}): Promise<ChatResult> {
  const settings = await getCurrent();
  const systemPrompt = settings.system_prompt;
  const model = settings.model || ASSISTANT_MODEL;

  const client = getClient();
  if (!client) {
    // No API key. Return a clear no-op response rather than crash so the
    // route stays well-behaved (and tests pass without hitting the live API).
    return {
      text:
        '[assistant offline: ANTHROPIC_API_KEY not configured — set it in ' +
        'your environment to enable chat]',
      blocks: [],
      tool_rounds: 0,
      live: false,
    };
  }

  const tools = ASSISTANT_TOOLS.map((t, idx) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema as { type: 'object'; [k: string]: unknown },
    // Cache the entire tools array as one block by tagging the last entry.
    // Anthropic caches everything up to and including a cache_control marker.
    ...(idx === ASSISTANT_TOOLS.length - 1
      ? { cache_control: { type: 'ephemeral' as const } }
      : {}),
  }));

  const workingMessages: { role: 'user' | 'assistant'; content: unknown }[] =
    messages.map((m) => ({ role: m.role, content: m.content }));

  let rounds = 0;
  let lastResponse: Awaited<
    ReturnType<typeof client.beta.promptCaching.messages.create>
  > | null = null;

  while (rounds <= MAX_TOOL_ROUNDS) {
    const response = await client.beta.promptCaching.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      system: [
        {
          type: 'text',
          text: systemPrompt,
          cache_control: { type: 'ephemeral' },
        },
      ],
      tools,
      messages: workingMessages as Parameters<
        typeof client.beta.promptCaching.messages.create
      >[0]['messages'],
    });
    lastResponse = response;

    if (response.stop_reason !== 'tool_use') {
      const blocks = response.content as unknown as unknown[];
      return {
        text: extractText(blocks),
        blocks,
        tool_rounds: rounds,
        usage: response.usage as unknown as Record<string, number | undefined>,
        live: true,
      };
    }

    const blocks = response.content as unknown as unknown[];
    const toolUses = toolUseBlocks(blocks);

    // Replay the assistant turn (including the tool_use blocks) into the
    // working history.
    workingMessages.push({
      role: 'assistant',
      content: blocks,
    });

    // Run each tool_use, append a single user message of tool_results.
    const toolResults: {
      type: 'tool_result';
      tool_use_id: string;
      content: string;
      is_error?: boolean;
    }[] = [];

    const impls = currentTools();
    for (const tu of toolUses) {
      const impl = impls[tu.name];
      if (!impl) {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: `unknown tool: ${tu.name}`,
          is_error: true,
        });
        continue;
      }
      try {
        const result = await impl(tu.input ?? {});
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: JSON.stringify(result ?? null),
        });
      } catch (err) {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: (err as Error).message ?? 'tool failed',
          is_error: true,
        });
      }
    }

    workingMessages.push({ role: 'user', content: toolResults });
    rounds += 1;
  }

  // Bail out — too many tool rounds. Treat as a soft failure rather than
  // throwing; surface the last text we have.
  const blocks = (lastResponse?.content ?? []) as unknown as unknown[];
  return {
    text: extractText(blocks) || '[assistant tool loop exceeded round cap]',
    blocks,
    tool_rounds: rounds,
    usage: lastResponse?.usage as unknown as Record<string, number | undefined>,
    live: true,
  };
}
