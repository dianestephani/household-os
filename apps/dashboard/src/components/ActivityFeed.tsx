import { useEffect, useState } from 'react';
import { api } from '../api.js';
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
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  if (key === todayKey) return 'Today';
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yKey = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
  if (key === yKey) return 'Yesterday';
  return new Date(key + 'T12:00').toLocaleDateString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export default function ActivityFeed() {
  const [entries, setEntries] = useState<ActivityLogEntry[] | null>(null);
  const [days, setDays] = useState(7);

  useEffect(() => {
    let cancelled = false;
    api.activity.list(days).then((d) => {
      if (!cancelled) setEntries(d);
    });
    return () => {
      cancelled = true;
    };
  }, [days]);

  if (!entries) return <div className="muted">Loading…</div>;
  if (entries.length === 0) {
    return (
      <div className="panel">
        <div className="muted">No activity in the last {days} days.</div>
      </div>
    );
  }

  const buckets = bucketByDay(entries);
  const orderedKeys = Array.from(buckets.keys()).sort().reverse();

  return (
    <>
      <div className="panel" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <strong style={{ flex: 1 }}>Activity</strong>
        <span className="muted">last</span>
        {[3, 7, 14, 30].map((n) => (
          <button
            key={n}
            className={`icon-btn ${days === n ? 'active' : ''}`}
            style={
              days === n
                ? { background: 'var(--accent)', color: 'white', borderColor: 'var(--accent)' }
                : {}
            }
            onClick={() => setDays(n)}
          >
            {n}d
          </button>
        ))}
      </div>

      {orderedKeys.map((key) => (
        <div key={key} className="panel">
          <strong>{dayLabel(key)}</strong>
          {(buckets.get(key) ?? []).map((e) => (
            <div key={e._id ?? `${e.ts}-${e.summary}`} className="row">
              <span style={{ width: '1.5em', color: 'var(--muted)' }}>
                {KIND_ICON[e.kind] ?? '·'}
              </span>
              <span className="name">{e.summary}</span>
              <span className="meta">
                {formatTime(e.ts)}
                {e.actor !== 'user' && (
                  <span style={{ marginLeft: '0.4em', opacity: 0.6 }}>
                    [{e.actor}]
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      ))}
    </>
  );
}
