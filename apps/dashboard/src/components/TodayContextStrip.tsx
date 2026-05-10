import { useEffect, useState } from 'react';
import { api } from '../api.js';
import type { ContextEntry } from '@household-os/shared/types';

/**
 * Compact read-only strip that surfaces today's journal entries on the Today
 * view, so the day's narrative context (load, energy, what got blocked) sits
 * right next to the plan that has to absorb it. Hides itself when empty.
 */
export default function TodayContextStrip() {
  const [entries, setEntries] = useState<ContextEntry[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        setEntries(await api.context.today());
      } catch {
        // best-effort: a missing context endpoint shouldn't break the Today view
      }
    })();
  }, []);

  if (entries.length === 0) return null;

  return (
    <div
      className="panel"
      style={{ borderLeft: '3px solid var(--accent)', paddingLeft: '0.75rem' }}
    >
      <strong>Today's context</strong>
      <ul style={{ listStyle: 'none', padding: 0, margin: '0.4rem 0 0 0' }}>
        {entries.map((e) => (
          <li
            key={String(e._id)}
            style={{ padding: '0.3rem 0', fontSize: '0.9rem' }}
          >
            <div style={{ whiteSpace: 'pre-wrap' }}>{e.text}</div>
            {(e.energy ||
              e.mood ||
              typeof e.dogsit_count === 'number' ||
              (e.blocked_activities && e.blocked_activities.length > 0)) && (
              <div
                className="muted"
                style={{ fontSize: '0.78rem', marginTop: '0.15rem' }}
              >
                {e.energy && <span>energy: {e.energy} · </span>}
                {e.mood && <span>mood: {e.mood} · </span>}
                {typeof e.dogsit_count === 'number' && (
                  <span>dogs: {e.dogsit_count} · </span>
                )}
                {e.blocked_activities && e.blocked_activities.length > 0 && (
                  <span>blocked: {e.blocked_activities.join(', ')}</span>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
