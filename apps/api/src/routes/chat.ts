import { Router } from 'express';
import { assistantChat, type ChatRequestMessage } from '../persona/runner.js';

/**
 * Unified-assistant chat endpoint. §50 Phase A.
 *   POST /api/chat
 *     body: { messages: [{ role: 'user' | 'assistant', content: string | blocks }] }
 *     reply: { text, blocks, tool_rounds, usage, live }
 */

const router: Router = Router();

router.post('/', async (req, res) => {
  const body = (req.body ?? {}) as { messages?: unknown };
  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: 'messages (non-empty array) required' });
    return;
  }
  // Light validation — let Anthropic surface any shape issues for content.
  for (const m of messages) {
    if (!m || typeof m !== 'object') {
      res.status(400).json({ error: 'each message must be an object' });
      return;
    }
    const role = (m as { role?: string }).role;
    if (role !== 'user' && role !== 'assistant') {
      res.status(400).json({ error: 'message.role must be "user" or "assistant"' });
      return;
    }
    if ((m as { content?: unknown }).content === undefined) {
      res.status(400).json({ error: 'message.content required' });
      return;
    }
  }

  try {
    const result = await assistantChat({
      messages: messages as ChatRequestMessage[],
    });
    res.json(result);
  } catch (err) {
    console.error('[chat] assistantChat failed', err);
    res.status(500).json({ error: (err as Error).message ?? 'chat failed' });
  }
});

export default router;
