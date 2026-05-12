import { useEffect, useState } from 'react';
import { api } from '../api.js';
import type {
  MorningCheckin,
  WorkoutLog,
} from '@household-os/shared/types';

/**
 * §50 Phase C — minimal Look Back. Three read-only stacked sections:
 *
 *   1. This week — workout count vs target (3/week); 7-day morning-checkin
 *      strip rendered as colored dots per pulse.
 *   2. This month — placeholder card pointing at Stuff/Finance until Phase D
 *      wires the RocketMoney-import summary + projected income view.
 *   3. Patterns — placeholder card. Phase D adds the hardcoded pattern
 *      queries ("you skipped strength training 3 times in 30 days, all on
 *      groggy mornings"), surfaced only when there's enough signal.
 *
 * No editing here — Look Back is purely retrospective per §50 ("introspective,
 * not prescriptive"). Tap-through to Stuff if she wants to change something.
 */

const STRENGTH_WEEKLY_TARGET = 3;

const DAY_FMT = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'numeric',
  day: 'numeric',
});

export default function LookBackPanel() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <ThisWeekSection />
      <ThisMonthPlaceholder />
      <PatternsPlaceholder />
    </div>
  );
}

function ThisWeekSection() {
  const [checkins, setCheckins] = useState<MorningCheckin[]>([]);
  const [workouts, setWorkouts] = useState<WorkoutLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [c, w] = await Promise.all([
          api.morningCheckin.recent(7),
          api.workouts.list(7),
        ]);
        setCheckins(c);
        setWorkouts(w);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const strengthDone = workouts.filter(
    (w) => w.status === 'done' || w.status === 'partial',
  ).length;

  return (
    <div className="panel">
      <strong>This week</strong>

      <div style={{ marginTop: '0.6rem' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            gap: '0.5rem',
          }}
        >
          <span style={{ fontSize: '0.95rem' }}>Workouts</span>
          <span
            className="muted"
            style={{
              fontSize: '0.88rem',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {strengthDone} of {STRENGTH_WEEKLY_TARGET} target
          </span>
        </div>
        <div
          style={{
            marginTop: '0.35rem',
            display: 'flex',
            gap: '0.3rem',
          }}
        >
          {Array.from({ length: STRENGTH_WEEKLY_TARGET }).map((_, i) => (
            <span
              key={i}
              aria-hidden
              style={{
                display: 'inline-block',
                width: '1rem',
                height: '1rem',
                borderRadius: '50%',
                background:
                  i < strengthDone ? 'var(--good)' : 'var(--bg-subtle, transparent)',
                border: '1px solid var(--border)',
              }}
            />
          ))}
        </div>
      </div>

      <div style={{ marginTop: '0.9rem' }}>
        <div style={{ fontSize: '0.95rem' }}>Morning check-ins</div>
        {loading && (
          <div className="muted" style={{ marginTop: '0.3rem' }}>
            Loading…
          </div>
        )}
        {error && (
          <div className="muted" style={{ marginTop: '0.3rem', color: 'var(--bad)' }}>
            {error}
          </div>
        )}
        {!loading && checkins.length === 0 && (
          <div className="muted" style={{ marginTop: '0.3rem', fontSize: '0.88rem' }}>
            No check-ins in the last 7 days.
          </div>
        )}
        {checkins.length > 0 && (
          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              margin: '0.4rem 0 0 0',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.25rem',
            }}
          >
            {checkins.map((c) => {
              const [y, m, d] = c.date.split('-').map(Number);
              const dayLabel =
                y && m && d ? DAY_FMT.format(new Date(y, m - 1, d)) : c.date;
              return (
                <li
                  key={c.date}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '5rem 1fr',
                    alignItems: 'baseline',
                    gap: '0.5rem',
                    padding: '0.3rem 0',
                    borderBottom: '1px solid var(--border)',
                    fontSize: '0.88rem',
                  }}
                >
                  <span className="muted" style={{ fontSize: '0.82rem' }}>
                    {dayLabel}
                  </span>
                  <span>
                    {c.mood} · {c.energy} energy · {c.awakeness}
                    {c.note && (
                      <span className="muted" style={{ fontSize: '0.82rem' }}>
                        {' — '}
                        {c.note.slice(0, 60)}
                        {c.note.length > 60 ? '…' : ''}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function ThisMonthPlaceholder() {
  return (
    <div className="panel">
      <strong>This month</strong>
      <div
        className="muted"
        style={{ marginTop: '0.4rem', fontSize: '0.88rem' }}
      >
        RocketMoney import summary + projected income land in Phase D. For now,
        view the latest snapshot under Stuff → Finance.
      </div>
    </div>
  );
}

function PatternsPlaceholder() {
  return (
    <div className="panel">
      <strong>Patterns</strong>
      <div
        className="muted"
        style={{ marginTop: '0.4rem', fontSize: '0.88rem' }}
      >
        Phase D adds a small pattern surfacer (e.g. "skipped strength training
        3 times in 30 days — all on groggy mornings"). Pure observation, no
        recommendation; hides when there's nothing notable.
      </div>
    </div>
  );
}
