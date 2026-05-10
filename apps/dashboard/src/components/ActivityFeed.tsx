import { useEffect, useState } from 'react';
import { api } from '../api.js';
import DayNavigator, { formatHeader, localToday } from './DayNavigator.js';
import type { ActivityKind, ActivityLogEntry } from '@household-os/shared/types';

const KIND_ICON: Partial<Record<ActivityKind, string>> = {
  task_done: '✓',
  task_deferred: '⤷',
  task_swapped: '⇄',
  task_pulled: '⤴',
  task_created: '＋',
  task_cancelled: '✕',
  plan_generated: '◐',
  plan_regenerated: '◑',
  energy_logged: '⚡',
  mood_logged: '☺',
  workout_logged: '💪',
  zone_assessed: '◊',
  check_in_created: '?',
  check_in_answered: '✓?',
  check_in_skipped: '⤳',
  trigger_added: '⌖',
  routine_edited: '✎',
  context_logged: '✎',
};

function formatTime(ts: Date | string): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return time;
  const date = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return `${date} ${time}`;
}

function bucketByDay(entries: ActivityLogEntry[]): Map<string, ActivityLogEntry[]> {
  const buckets = new Map<string, ActivityLogEntry[]>();
  for (const e of entries) {
    const d = new Date(e.ts);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const arr = buckets.get(key) ?? [];
    arr.push(e);
    buckets.set(key, arr);
  }
  return buckets;
}

function dayLabel(key: string): string {
  const today = localToday();
  if (key === today) return 'Today';
  const t = new Date();
  t.setDate(t.getDate() - 1);
  const yKey = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  if (key === yKey) return 'Yesterday';
  return formatHeader(key);
}

type Mode = 'range' | 'day';

export default function ActivityFeed() {
  const [mode, setMode] = useState<Mode>('range');
  const [days, setDays] = useState(7);
  const [date, setDate] = useState(localToday());
  const [entries, setEntries] = useState<ActivityLogEntry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetcher =
      mode === 'day' ? api.activity.onDate(date) : api.activity.list(days);
    fetcher.then((d) => {
      if (!cancelled) setEntries(d);
    });
    return () => {
      cancelled = true;
    };
  }, [mode, days, date]);

  return (
    <>
      <div
        className="panel"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          flexWrap: 'wrap',
        }}
      >
        <strong style={{ flex: 1 }}>Activity</strong>
        <ModeToggle current={mode} onChange={setMode} />
      </div>

      {mode === 'range' && (
        <div
          className="panel"
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
        >
          <span className="muted">last</span>
          {[3, 7, 14, 30].map((n) => (
            <button
              key={n}
              className="icon-btn"
              style={
                days === n
                  ? {
                      background: 'var(--accent)',
                      color: 'var(--accent-fg)',
                      borderColor: 'var(--accent)',
                    }
                  : {}
              }
              onClick={() => setDays(n)}
            >
              {n}d
            </button>
          ))}
        </div>
      )}

      {mode === 'day' && <DayNavigator date={date} onChange={setDate} />}

      {!entries && <div className="muted">Loading…</div>}

      {entries && entries.length === 0 && (
        <div className="panel">
          <div className="muted">
            {mode === 'range'
              ? `No activity in the last ${days} days.`
              : `No activity logged on ${formatHeader(date)}.`}
          </div>
        </div>
      )}

      {entries && entries.length > 0 && mode === 'range' && (
        <>
          {Array.from(bucketByDay(entries).entries())
            .sort((a, b) => (a[0] > b[0] ? -1 : 1))
            .map(([key, dayEntries]) => (
              <div key={key} className="panel">
                <strong>{dayLabel(key)}</strong>
                {dayEntries.map((e) => (
                  <ActivityRow key={String(e._id ?? `${e.ts}-${e.summary}`)} entry={e} />
                ))}
              </div>
            ))}
        </>
      )}

      {entries && entries.length > 0 && mode === 'day' && (
        <div className="panel">
          {entries.map((e) => (
            <ActivityRow key={String(e._id ?? `${e.ts}-${e.summary}`)} entry={e} />
          ))}
        </div>
      )}
    </>
  );
}

function ActivityRow({ entry }: { entry: ActivityLogEntry }) {
  return (
    <div className="row">
      <span style={{ width: '1.5em', color: 'var(--muted)' }}>
        {KIND_ICON[entry.kind] ?? '·'}
      </span>
      <span className="name">{entry.summary}</span>
      <span className="meta">
        {formatTime(entry.ts)}
        {entry.actor !== 'user' && (
          <span style={{ marginLeft: '0.4em', opacity: 0.6 }}>[{entry.actor}]</span>
        )}
      </span>
    </div>
  );
}

function ModeToggle({
  current,
  onChange,
}: {
  current: Mode;
  onChange: (m: Mode) => void;
}) {
  return (
    <div style={{ display: 'flex', gap: '0.3rem' }}>
      {(['range', 'day'] as Mode[]).map((m) => {
        const active = m === current;
        return (
          <button
            key={m}
            type="button"
            onClick={() => onChange(m)}
            style={{
              padding: '0.3rem 0.75rem',
              borderRadius: '999px',
              border: '1px solid var(--border)',
              background: active ? 'var(--accent)' : 'var(--panel)',
              color: active ? 'var(--accent-fg)' : 'var(--text)',
              fontSize: '0.82rem',
              fontWeight: 500,
              letterSpacing: '0.02em',
            }}
          >
            {m === 'range' ? 'Range' : 'Single day'}
          </button>
        );
      })}
    </div>
  );
}
