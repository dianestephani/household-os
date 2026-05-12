import { useEffect, useRef, useState } from 'react';
import { api, type ChatMessage, type ChatResult } from '../api.js';

/**
 * §50 Phase B — chat with the unified assistant. POSTs to `/api/chat`, which
 * runs the tool-use loop with prompt caching. Conversation state lives in
 * component memory; nothing persists yet (a `ChatMessage` collection is
 * sketched in §50 but not built in Phase B).
 *
 * Offline path: when `ANTHROPIC_API_KEY` isn't set on the API, the route
 * returns `{live: false}` with a clear "configure your key" message. We show
 * that verbatim so Diane gets the actionable hint.
 */

interface UiMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  tool_rounds?: number;
  live?: boolean;
}

const MAX_RENDERED = 40;

export default function AskPanel() {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (scrollerRef.current) {
      scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
    }
  }, [messages.length, sending]);

  async function handleSend() {
    const text = draft.trim();
    if (!text || sending) return;
    const userMsg: UiMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      text,
    };
    const nextUi = [...messages, userMsg];
    setMessages(nextUi);
    setDraft('');
    setSending(true);
    setError(null);

    const apiMessages: ChatMessage[] = nextUi.map((m) => ({
      role: m.role,
      content: m.text,
    }));

    try {
      const result: ChatResult = await api.chat.send(apiMessages);
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          text: result.text || '(empty response)',
          tool_rounds: result.tool_rounds,
          live: result.live,
        },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Cmd/Ctrl+Enter sends; plain Enter inserts a newline.
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void handleSend();
    }
  }

  const rendered = messages.slice(-MAX_RENDERED);

  return (
    <div className="panel">
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: '0.5rem',
        }}
      >
        <strong>Ask</strong>
        <span className="muted" style={{ fontSize: '0.78rem' }}>
          ⌘/Ctrl + Enter to send
        </span>
      </div>

      <div
        ref={scrollerRef}
        style={{
          marginTop: '0.6rem',
          maxHeight: '24rem',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.5rem',
          paddingRight: '0.25rem',
        }}
      >
        {rendered.length === 0 && (
          <div className="muted" style={{ fontSize: '0.88rem' }}>
            Ask anything — what's on the calendar today, can I afford to bump
            the cleaner, log a workout I did yesterday, add a routine. The
            assistant uses your real data.
          </div>
        )}
        {rendered.map((m) => (
          <div
            key={m.id}
            style={{
              alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '85%',
              padding: '0.5rem 0.7rem',
              borderRadius: '10px',
              border: '1px solid var(--border)',
              background:
                m.role === 'user' ? 'var(--bg-subtle, transparent)' : 'transparent',
              fontSize: '0.92rem',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {m.text}
            {m.role === 'assistant' && m.live === false && (
              <div
                className="muted"
                style={{ marginTop: '0.3rem', fontSize: '0.78rem' }}
              >
                (offline — add ANTHROPIC_API_KEY to enable live chat)
              </div>
            )}
            {m.role === 'assistant' &&
              typeof m.tool_rounds === 'number' &&
              m.tool_rounds > 0 && (
                <div
                  className="muted"
                  style={{ marginTop: '0.3rem', fontSize: '0.78rem' }}
                >
                  {m.tool_rounds} tool {m.tool_rounds === 1 ? 'call' : 'calls'}
                </div>
              )}
          </div>
        ))}
        {sending && (
          <div
            className="muted"
            style={{ alignSelf: 'flex-start', fontSize: '0.85rem' }}
          >
            thinking…
          </div>
        )}
      </div>

      {error && (
        <div
          className="muted"
          style={{
            marginTop: '0.5rem',
            color: 'var(--bad)',
            fontSize: '0.85rem',
          }}
        >
          {error}
        </div>
      )}

      <div style={{ marginTop: '0.6rem', display: 'flex', gap: '0.4rem' }}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKey}
          rows={2}
          placeholder="Ask the assistant…"
          disabled={sending}
          style={{
            flex: 1,
            padding: '0.5rem 0.6rem',
            border: '1px solid var(--border)',
            borderRadius: '6px',
            background: 'var(--bg)',
            color: 'var(--text)',
            fontFamily: 'inherit',
            fontSize: '0.92rem',
            resize: 'vertical',
            boxSizing: 'border-box',
          }}
        />
        <button
          type="button"
          className="theme-toggle"
          onClick={() => void handleSend()}
          disabled={sending || !draft.trim()}
          style={{ alignSelf: 'flex-end' }}
        >
          {sending ? '…' : 'Send'}
        </button>
      </div>
    </div>
  );
}
