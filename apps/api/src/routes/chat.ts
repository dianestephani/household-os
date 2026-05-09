import { Router } from 'express';
import { chat, type ChatMessage } from '../persona/runner.js';

const router: Router = Router();

router.post('/:persona', async (req, res) => {
  const persona = req.params.persona!;
  const { messages } = (req.body ?? {}) as { messages?: ChatMessage[] };
  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: 'messages required' });
    return;
  }
  try {
    const result = await chat(persona, messages);
    res.json(result);
  } catch (err) {
    console.error('[chat] error', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'chat failed' });
  }
});

export default router;
