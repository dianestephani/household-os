import { useState } from 'react';
import { api } from '../api.js';
import type { EnergyLevel, EnergySuggestion, TodayPlan } from '@household-os/shared/types';

interface Props {
  current: EnergyLevel;
  onChange: (plan: TodayPlan) => void;
}

const LEVELS: EnergyLevel[] = ['low', 'medium', 'high'];

export default function EnergyButtons({ current, onChange }: Props) {
  const [pending, setPending] = useState<EnergySuggestion | null>(null);
  const [busy, setBusy] = useState(false);

  async function setLevel(level: EnergyLevel) {
    setBusy(true);
    try {
      const suggestion = await api.energy.set(level);
      if (
        suggestion.suggested_swaps_in.length === 0 &&
        suggestion.suggested_swaps_out.length === 0
      ) {
        onChange(await api.today.get());
      } else {
        setPending(suggestion);
      }
    } finally {
      setBusy(false);
    }
  }

  async function applySuggestion() {
    if (!pending) return;
    for (const out of pending.suggested_swaps_out) {
      await api.today.swap(out.routine_key);
    }
    for (const inItem of pending.suggested_swaps_in) {
      await api.today.pullFromPool(inItem.routine_key);
    }
    onChange(await api.today.get());
    setPending(null);
  }

  return (
    <>
      <div className="panel">
        <div style={{ marginBottom: '0.5rem' }}>
          <strong>Energy</strong> <span className="muted">(currently {current})</span>
        </div>
        <div className="energy-buttons">
          {LEVELS.map((l) => (
            <button
              key={l}
              className={l === current ? 'active' : ''}
              disabled={busy}
              onClick={() => setLevel(l)}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      {pending && (
        <div className="suggestion-modal" onClick={() => setPending(null)}>
          <div className="box" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Energy: {pending.level}</h3>
            <p className="muted">{pending.rationale}</p>

            {pending.suggested_swaps_out.length > 0 && (
              <>
                <strong>Move out:</strong>
                <ul>
                  {pending.suggested_swaps_out.map((s) => (
                    <li key={s.routine_key}>{s.name} ({s.energy})</li>
                  ))}
                </ul>
              </>
            )}
            {pending.suggested_swaps_in.length > 0 && (
              <>
                <strong>Pull in:</strong>
                <ul>
                  {pending.suggested_swaps_in.map((s) => (
                    <li key={s.routine_key}>{s.name} ({s.energy})</li>
                  ))}
                </ul>
              </>
            )}
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
              <button className="icon-btn" onClick={() => setPending(null)}>
                cancel
              </button>
              <button onClick={applySuggestion}>apply</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
