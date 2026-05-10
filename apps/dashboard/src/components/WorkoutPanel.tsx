import { useEffect, useState } from 'react';
import { api } from '../api.js';
import DayNavigator, { localToday } from './DayNavigator.js';
import type {
  WorkoutLog,
  WorkoutSlotKey,
  WorkoutStatus,
  WorkoutPattern,
} from '@household-os/shared/types';

interface DayState {
  slot: { slot_key: WorkoutSlotKey; name: string; type: string } | null;
  log: WorkoutLog | null;
}

const STATUSES: WorkoutStatus[] = ['done', 'partial', 'skipped'];

export default function WorkoutPanel() {
  const [date, setDate] = useState(localToday());
  const [day, setDay] = useState<DayState | null>(null);
  const [history, setHistory] = useState<WorkoutLog[] | null>(null);
  const [pattern, setPattern] = useState<WorkoutPattern | null>(null);
  const [busy, setBusy] = useState(false);

  const isToday = date === localToday();

  async function refreshDay(targetDate: string = date) {
    const d = await api.workouts.byDate(targetDate);
    setDay(d);
  }

  async function refreshStats() {
    const [h, p] = await Promise.all([
      api.workouts.list(14),
      api.patterns.workouts(14),
    ]);
    setHistory(h);
    setPattern(p);
  }

  useEffect(() => {
    void refreshDay(date);
  }, [date]);

  useEffect(() => {
    void refreshStats();
  }, []);

  async function setStatus(status: WorkoutStatus) {
    if (!day?.slot || !isToday) return;
    setBusy(true);
    try {
      await api.workouts.log({ slot_key: day.slot.slot_key, status });
      await Promise.all([refreshDay(), refreshStats()]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DayNavigator date={date} onChange={setDate} />

      {!day && <div className="muted">Loading workout…</div>}

      {day && (
        <div className="panel">
          <strong>
            {isToday ? "Today's workout" : `Workout (${date})`}
          </strong>
          {day.slot ? (
            <>
              <div style={{ margin: '0.5rem 0' }}>
                {day.slot.name}{' '}
                <span className="muted">({day.slot.type})</span>
              </div>
              {day.log ? (
                <div className="muted">
                  Logged: <strong>{day.log.status}</strong>
                  {day.log.notes && <> · {day.log.notes}</>}
                </div>
              ) : isToday ? (
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
              ) : (
                <div className="muted" style={{ fontStyle: 'italic' }}>
                  Not logged. Logging is only enabled for today.
                </div>
              )}
            </>
          ) : (
            <div className="muted" style={{ marginTop: '0.5rem' }}>
              No protected workout slot on this day.
            </div>
          )}
        </div>
      )}

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
            <div
              key={`${log.date}-${log.slot_key}`}
              className="row"
              onClick={() => setDate(log.date)}
              style={{ cursor: 'pointer' }}
              title={`Jump to ${log.date}`}
            >
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
