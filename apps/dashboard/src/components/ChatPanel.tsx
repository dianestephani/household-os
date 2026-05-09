import { useState } from 'react';
import { api } from '../api.js';

interface Msg {
  role: 'user' | 'assistant';
  content: string;
}

interface Props {
  persona: string;
  stub?: boolean;
  onUpdate?: () => void;
}

export default function ChatPanel({ persona, stub, onUpdate }: Props) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);

  if (stub) {
    return (
      <div className="panel">
        <p className="muted">
          The {persona} persona is in stub mode. v1 only ships Household Ops; this tab is here so you
          can plug it in later.
        </p>
      </div>
    );
  }

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    if (!input.trim()) return;
    const next = [...messages, { role: 'user' as const, content: input.trim() }];
    setMessages(next);
    setInput('');
    setBusy(true);
    try {
      const res = await api.chat(persona, next);
      setMessages([...next, { role: 'assistant', content: res.reply }]);
      onUpdate?.();
    } catch (err) {
      setMessages([
        ...next,
        { role: 'assistant', content: `error: ${err instanceof Error ? err.message : err}` },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel chat">
      <div className="messages">
        {messages.length === 0 && <div className="muted">Ask Household Ops something.</div>}
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            <strong>{m.role}:</strong> {m.content}
          </div>
        ))}
      </div>
      <form className="input" onSubmit={send}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="What's on today?"
          disabled={busy}
        />
        <button type="submit" disabled={busy || !input.trim()}>
          send
        </button>
      </form>
    </div>
  );
}
