import { useEffect, useState } from 'react';
import { api } from '../api.js';
import type {
  WorkoutLog,
  WorkoutSlotKey,
  WorkoutStatus,
  WorkoutPattern,
} from '@household-os/shared/types';

interface TodayState {
  slot: { slot_key: WorkoutSlotKey; name: string; type: string } | null;
  log: WorkoutLog | null;
}

const STATUSES: WorkoutStatus[] = ['done', 'partial', 'skipped'];

export default function WorkoutPanel() {
  const [today, setToday] = useState<TodayState | null>(null);
  const [history, setHistory] = useState<WorkoutLog[] | null>(null);
  const [pattern, setPattern] = useState<WorkoutPattern | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const [t, h, p] = await Promise.all([
      api.workouts.today(),
      api.workouts.list(14),
      api.patterns.workouts(14),
    ]);
    setToday(t);
    setHistory(h);
    setPattern(p);
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function setStatus(status: WorkoutStatus) {
    if (!today?.slot) return;
    setBusy(true);
    try {
      await api.workouts.log({ slot_key: today.slot.slot_key, status });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!today) return <div className="muted">Loading workouts…</div>;

  return (
    <>
      <div className="panel">
        <strong>Today's workout</strong>
        {today.slot ? (
          <>
            <div style={{ margin: '0.5rem 0' }}>
              {today.slot.name}{' '}
              <span className="muted">({today.slot.type})</span>
            </div>
            {today.log ? (
              <div className="muted">
                Logged: <strong>{today.log.status}</strong>
              </div>
            ) : (
              <div className="energy-buttons">
                {STATUSES.map((s) => (
                  <button
                    key={s}
                    disabled={busy}
                    onClick={() => setStatus(s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="muted" style={{ marginTop: '0.5rem' }}>
            No protected workout slot today.
          </div>
        )}
      </div>

      {pattern && (
        <div className="panel">
          <strong>Last {pattern.window_days} days</strong>
          <div className="muted" style={{ marginTop: '0.25rem' }}>
            {pattern.done} done · {pattern.partial} partial · {pattern.skipped} skipped
            {' '}({pattern.scheduled} scheduled days)
          </div>
          {pattern.recent_streaks.length > 0 && (
            <div className="muted">
              Streaks:{' '}
              {pattern.recent_streaks
                .map((s) => `${s.length} ${s.kind}`)
                .join(', ')}
            </div>
          )}
        </div>
      )}

      {history && history.length > 0 && (
        <div className="panel">
          <strong>History</strong>
          {history.map((log) => (
            <div key={`${log.date}-${log.slot_key}`} className="row">
              <span className="name">{log.date}</span>
              <span className="meta">
                {log.slot_key} · {log.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
