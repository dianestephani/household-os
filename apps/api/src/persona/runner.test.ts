import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  assistantChat,
  __setAnthropicClient,
  __setAssistantTools,
} from './runner.js';
import type { ToolImpl } from './assistant-tools.js';

/**
 * Runner tests for the unified assistant. The Anthropic SDK is stubbed via
 * the test hooks — we never hit the live API. Service-level behavior is
 * covered in assistant-tools.test.ts; this file only exercises the
 * tool-use loop control flow.
 */

afterEach(() => {
  __setAnthropicClient(null);
  __setAssistantTools(null);
});

describe('assistantChat — no-key path', () => {
  it('returns a clear offline reply when no API client is available', async () => {
    __setAnthropicClient(null); // explicit even though afterEach does it
    const prev = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    const result = await assistantChat({
      messages: [{ role: 'user', content: 'hello' }],
    });

    expect(result.live).toBe(false);
    expect(result.tool_rounds).toBe(0);
    expect(result.text).toMatch(/ANTHROPIC_API_KEY/);

    if (prev !== undefined) process.env.ANTHROPIC_API_KEY = prev;
  });
});

describe('assistantChat — tool-use loop', () => {
  function makeStubClient(turns: unknown[]): Parameters<typeof __setAnthropicClient>[0] {
    let idx = 0;
    const create = vi.fn(async () => {
      const turn = turns[idx++];
      if (!turn) throw new Error('runner asked for more turns than stub provided');
      return turn as never;
    });
    // Shape matches the SDK surface the runner reaches into.
    return {
      beta: { promptCaching: { messages: { create } } },
    } as unknown as Parameters<typeof __setAnthropicClient>[0];
  }

  it('returns the final text on stop_reason=end_turn with no tool calls', async () => {
    __setAnthropicClient(
      makeStubClient([
        {
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'Hey there.' }],
          usage: { input_tokens: 10, output_tokens: 3 },
        },
      ]),
    );

    const result = await assistantChat({
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(result.live).toBe(true);
    expect(result.text).toBe('Hey there.');
    expect(result.tool_rounds).toBe(0);
  });

  it('runs a tool_use round, feeds tool_result back, and returns the followup', async () => {
    const fakeTool: ToolImpl = async (input) => ({
      received: input,
      ok: true,
    });
    __setAssistantTools({ list_routines: fakeTool });

    __setAnthropicClient(
      makeStubClient([
        // Turn 1: model asks for list_routines
        {
          stop_reason: 'tool_use',
          content: [
            {
              type: 'tool_use',
              id: 'tu_1',
              name: 'list_routines',
              input: { category: 'pet' },
            },
          ],
          usage: {},
        },
        // Turn 2: model finishes
        {
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'Two routines.' }],
          usage: {},
        },
      ]),
    );

    const result = await assistantChat({
      messages: [{ role: 'user', content: 'what pet routines do I have?' }],
    });
    expect(result.text).toBe('Two routines.');
    expect(result.tool_rounds).toBe(1);
  });

  it('returns is_error tool_result when the requested tool is unknown', async () => {
    __setAssistantTools({}); // no tools at all

    let secondTurnInput: unknown = null;
    const stubClient = {
      beta: {
        promptCaching: {
          messages: {
            create: vi
              .fn()
              .mockImplementationOnce(async () => ({
                stop_reason: 'tool_use',
                content: [
                  {
                    type: 'tool_use',
                    id: 'tu_unk',
                    name: 'this_tool_does_not_exist',
                    input: {},
                  },
                ],
                usage: {},
              }))
              .mockImplementationOnce(async (params: { messages: unknown[] }) => {
                secondTurnInput = params.messages;
                return {
                  stop_reason: 'end_turn',
                  content: [{ type: 'text', text: 'Sorry, retried.' }],
                  usage: {},
                };
              }),
          },
        },
      },
    } as unknown as Parameters<typeof __setAnthropicClient>[0];
    __setAnthropicClient(stubClient);

    const result = await assistantChat({
      messages: [{ role: 'user', content: 'do a thing' }],
    });

    expect(result.text).toBe('Sorry, retried.');
    expect(result.tool_rounds).toBe(1);
    // The second turn should carry an is_error tool_result block.
    const msgs = secondTurnInput as { role: string; content: unknown }[];
    const lastUser = msgs[msgs.length - 1];
    expect(lastUser?.role).toBe('user');
    const resultsBlock = (lastUser?.content as { is_error?: boolean }[])[0];
    expect(resultsBlock?.is_error).toBe(true);
  });

  it('caps tool rounds and returns a bailout message instead of infinite-looping', async () => {
    __setAssistantTools({
      list_routines: async () => ({ ok: true }),
    });

    // Always return tool_use → forces the runner to bail.
    const create = vi.fn(async () => ({
      stop_reason: 'tool_use',
      content: [
        {
          type: 'tool_use',
          id: 'tu_loop',
          name: 'list_routines',
          input: {},
        },
      ],
      usage: {},
    }));
    __setAnthropicClient({
      beta: { promptCaching: { messages: { create } } },
    } as unknown as Parameters<typeof __setAnthropicClient>[0]);

    const result = await assistantChat({
      messages: [{ role: 'user', content: 'loop forever' }],
    });
    expect(result.tool_rounds).toBeGreaterThan(0);
    expect(create.mock.calls.length).toBeLessThanOrEqual(10);
  });
});
