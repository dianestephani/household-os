import { useState } from 'react';
import { api } from '../api.js';
import type { MoodLevel } from '@household-os/shared/types';

const LEVELS: { level: MoodLevel; emoji: string; label: string }[] = [
  { level: 'down', emoji: '😞', label: 'down' },
  { level: 'neutral', emoji: '😐', label: 'neutral' },
  { level: 'good', emoji: '😀', label: 'good' },
];

export default function MoodButtons() {
  const [selected, setSelected] = useState<MoodLevel | null>(null);
  const [busy, setBusy] = useState(false);

  async function pick(level: MoodLevel) {
    setBusy(true);
    try {
      await api.mood.set(level);
      setSelected(level);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <div style={{ marginBottom: '0.5rem' }}>
        <strong>Mood</strong>{' '}
        {selected && <span className="muted">(logged: {selected})</span>}
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
