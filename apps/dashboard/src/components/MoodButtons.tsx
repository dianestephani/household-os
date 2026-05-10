import { useEffect, useState } from 'react';
import { api } from '../api.js';
import type { MoodLevel } from '@household-os/shared/types';

const LEVELS: { level: MoodLevel; emoji: string; label: string }[] = [
  { level: 'down', emoji: '😞', label: 'down' },
  { level: 'neutral', emoji: '😐', label: 'neutral' },
  { level: 'good', emoji: '😀', label: 'good' },
];

const TIME_FMT = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
});

function isToday(d: Date): boolean {
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

export default function MoodButtons() {
  const [selected, setSelected] = useState<MoodLevel | null>(null);
  const [loggedAt, setLoggedAt] = useState<Date | null>(null);
  const [busy, setBusy] = useState(false);

  // Prefill: if she already logged a mood today, show that as the selected
  // state so she sees ongoing confirmation across page reloads / tab switches.
  useEffect(() => {
    void (async () => {
      try {
        const recent = await api.mood.recent(1);
        const latest = recent[0];
        if (!latest) return;
        const ts = new Date(latest.ts);
        if (isToday(ts)) {
          setSelected(latest.level);
          setLoggedAt(ts);
        }
      } catch {
        /* best-effort prefill — silently skip on failure */
      }
    })();
  }, []);

  async function pick(level: MoodLevel) {
    setBusy(true);
    try {
      await api.mood.set(level);
      setSelected(level);
      setLoggedAt(new Date());
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: '0.5rem',
          gap: '0.5rem',
          flexWrap: 'wrap',
        }}
      >
        <strong>Mood</strong>
        {loggedAt && selected && (
          <span
            style={{
              color: 'var(--good)',
              fontSize: '0.82rem',
              fontWeight: 500,
            }}
          >
            ✓ Logged "{selected}" at {TIME_FMT.format(loggedAt)}
          </span>
        )}
      </div>
      <div className="energy-buttons">
        {LEVELS.map((m) => (
          <button
            key={m.level}
            disabled={busy}
            className={selected === m.level ? 'active' : ''}
            onClick={() => pick(m.level)}
          >
            {m.emoji} {m.label}
          </button>
        ))}
      </div>
    </div>
  );
}
