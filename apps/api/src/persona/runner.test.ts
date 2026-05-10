import { describe, it, expect, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { TodayPlan } from '../db/models/TodayPlan.js';
import { ymd } from '../utils/dates.js';
import { chat, type AnthropicLike } from './runner.js';

function fakeMessage(content: Anthropic.ContentBlock[], stop_reason: Anthropic.Message['stop_reason'] = 'end_turn'): Anthropic.Message {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-4-7',
    content,
    stop_reason,
    stop_sequence: null,
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      server_tool_use: null,
      service_tier: null,
    },
    container: null,
  } as unknown as Anthropic.Message;
}

function makeClient(responses: Anthropic.Message[]): { client: AnthropicLike; create: ReturnType<typeof vi.fn> } {
  let i = 0;
  const create = vi.fn(async () => {
    const r = responses[i];
    i += 1;
    if (!r) throw new Error('runner asked for more responses than mocked');
    return r;
  });
  return { client: { messages: { create } }, create };
}

describe('chat — stub personas short-circuit', () => {
  it('returns canned reply for grocery (launcher-only) without calling Claude', async () => {
    const { client, create } = makeClient([]);
    const res = await chat('grocery', [{ role: 'user', content: 'meal plan?' }], client);
    expect(res.reply).toMatch(/launcher-only|Food tab/i);
    expect(create).not.toHaveBeenCalled();
  });

  // Finance is no longer a stub — it has real tools (get_financial_profile,
  // affordability_report, etc.). Its tool-loop behavior is covered by the
  // finance service tests.
});

describe('chat — household persona', () => {
  it('returns plain text on end_turn', async () => {
    const { client } = makeClient([
      fakeMessage([{ type: 'text', text: 'Hello!', citations: null }] as unknown as Anthropic.ContentBlock[]),
    ]);
    const res = await chat('household', [{ role: 'user', content: 'hi' }], client);
    expect(res.reply).toBe('Hello!');
  });

  it('runs tool loop: tool_use → tool_result → final text', async () => {
    await TodayPlan.create({
      date: ymd(new Date()),
      day_type: 'weekday_default',
      budget_minutes: 45,
      current_energy: 'medium',
      items: [],
      swap_pool: [],
      publisher: {},
    });

    const { client, create } = makeClient([
      fakeMessage(
        [
          {
            type: 'tool_use',
            id: 'toolu_1',
            name: 'get_today',
            input: {},
          },
        ] as unknown as Anthropic.ContentBlock[],
        'tool_use',
      ),
      fakeMessage([
        { type: 'text', text: 'Plan is empty.', citations: null },
      ] as unknown as Anthropic.ContentBlock[]),
    ]);
    const res = await chat(
      'household',
      [{ role: 'user', content: "what's on?" }],
      client,
    );
    expect(create).toHaveBeenCalledTimes(2);
    expect(res.reply).toBe('Plan is empty.');
  });

  it('reports unknown persona', async () => {
    const { client } = makeClient([]);
    const res = await chat('does-not-exist', [{ role: 'user', content: 'x' }], client);
    expect(res.reply).toMatch(/unknown persona/i);
  });
});
