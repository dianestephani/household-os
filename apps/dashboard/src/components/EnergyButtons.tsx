import { useState } from 'react';
import { api } from '../api.js';
import type { EnergyLevel, EnergySuggestion, TodayPlan } from '@household-os/shared/types';

interface Props {
  current: EnergyLevel;
  onChange: (plan: TodayPlan) => void;
}

const LEVELS: EnergyLevel[] = ['low', 'medium', 'high'];

const TIME_FMT = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
});

export default function EnergyButtons({ current, onChange }: Props) {
  const [pending, setPending] = useState<EnergySuggestion | null>(null);
  const [busy, setBusy] = useState(false);
  const [loggedAt, setLoggedAt] = useState<Date | null>(null);
  const [loggedLevel, setLoggedLevel] = useState<EnergyLevel | null>(null);

  async function setLevel(level: EnergyLevel) {
    setBusy(true);
    try {
      const suggestion = await api.energy.set(level);
      // Energy is logged on the backend regardless of whether suggestions are
      // returned. Surface that as the "✓ Logged" indicator immediately so
      // the user sees confirmation even before the modal flow completes.
      setLoggedLevel(level);
      setLoggedAt(new Date());

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

  // Cancelling the modal still means the energy *was* logged — refetch the
  // plan so `current` updates (active-state highlight follows reality).
  // Without this, dismissing the modal leaves the old `current_energy`
  // visible even though the new level was persisted.
  async function dismissSuggestion() {
    setPending(null);
    onChange(await api.today.get());
  }

  return (
    <>
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
          <span>
            <strong>Energy</strong>{' '}
            <span className="muted">(currently {current})</span>
          </span>
          {loggedAt && loggedLevel && (
            <span
              style={{
                color: 'var(--good)',
                fontSize: '0.82rem',
                fontWeight: 500,
              }}
            >
              ✓ Logged "{loggedLevel}" at {TIME_FMT.format(loggedAt)}
            </span>
          )}
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
        <div className="suggestion-modal" onClick={dismissSuggestion}>
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
              <button className="icon-btn" onClick={dismissSuggestion}>
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
