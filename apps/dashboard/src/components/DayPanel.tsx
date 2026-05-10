import { useEffect, useState } from 'react';
import { api } from '../api.js';
import TodayList from './TodayList.js';
import EnergyButtons from './EnergyButtons.js';
import MoodButtons from './MoodButtons.js';
import CheckInBanner from './CheckInBanner.js';
import CalendarDayPanel from './CalendarDayPanel.js';
import TodayContextStrip from './TodayContextStrip.js';
import DayNavigator, { localToday } from './DayNavigator.js';
import type {
  CalendarEvent,
  CalendarTask,
  ContextEntry,
  DayView,
  PlanItem,
  ScheduleRoutineDue,
  TodayPlan,
} from '@household-os/shared/types';

const TIME_FMT = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
});

export default function DayPanel({
  initialPlan,
  onPlanChange,
}: {
  initialPlan: TodayPlan | null;
  onPlanChange: (plan: TodayPlan | null) => void;
}) {
  const todayKey = localToday();
  const [date, setDate] = useState(todayKey);
  const [view, setView] = useState<DayView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isToday = date === todayKey;

  async function load(targetDate: string) {
    try {
      setError(null);
      const v = await api.day.get(targetDate);
      setView(v);
      if (targetDate === todayKey) onPlanChange(v.plan);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    void load(date);
  }, [date]);

  // If parent's initialPlan changes (e.g. another component mutated today's
  // plan), surface the update when we're viewing today.
  useEffect(() => {
    if (isToday && initialPlan) {
      setView((v) => (v ? { ...v, plan: initialPlan } : v));
    }
  }, [initialPlan, isToday]);

  function handlePlanMutation(plan: TodayPlan) {
    setView((v) => (v ? { ...v, plan } : v));
    onPlanChange(plan);
  }

  return (
    <>
      <DayNavigator date={date} onChange={setDate} />

      {error && (
        <div className="panel" style={{ borderColor: 'var(--bad)' }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {!view && !error && <div className="muted">Loading…</div>}

      {view && (
        <>
          {isToday && <CheckInBanner />}

          {view.events.length > 0 || isToday ? (
            isToday ? (
              <CalendarDayPanel />
            ) : (
              <DayEventsPanel events={view.events} dateStr={view.date} />
            )
          ) : null}

          {view.context.length > 0 &&
            (isToday ? (
              <TodayContextStrip />
            ) : (
              <DayContextPanel entries={view.context} />
            ))}

          {view.tasks.length > 0 && (
            <TasksPanel
              tasks={view.tasks}
              isToday={isToday}
              onTaskUpdate={(updated) =>
                setView((v) =>
                  v
                    ? {
                        ...v,
                        tasks: v.tasks.map((t) =>
                          t.id === updated.id ? updated : t,
                        ),
                      }
                    : v,
                )
              }
            />
          )}

          {isToday && view.plan && (
            <>
              <EnergyButtons
                current={view.plan.current_energy}
                onChange={handlePlanMutation}
              />
              <MoodButtons />
              <TodayList plan={view.plan} onChange={handlePlanMutation} />
            </>
          )}

          {!isToday && view.is_past && view.plan && (
            <PastPlanPanel plan={view.plan} />
          )}

          {!isToday && view.is_past && !view.plan && (
            <div className="panel">
              <strong>No plan recorded</strong>
              <p className="muted" style={{ marginTop: '0.4rem' }}>
                Morning-gen didn't run on this day, so there's no stored plan to show.
              </p>
            </div>
          )}

          {view.is_future && (
            <ForecastPanel forecast={view.forecast} />
          )}
        </>
      )}
    </>
  );
}

function PastPlanPanel({ plan }: { plan: TodayPlan }) {
  return (
    <div className="panel">
      <strong>Plan ({plan.items.length} items, read-only history)</strong>
      <ul style={{ listStyle: 'none', padding: 0, margin: '0.5rem 0 0 0' }}>
        {plan.items.map((item) => (
          <li
            key={item.routine_key}
            style={{
              padding: '0.5rem 0',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'baseline',
              gap: '0.5rem',
            }}
          >
            <span style={{ flex: 1 }}>
              {item.status === 'done' && <span style={{ marginRight: '0.4rem' }}>✓</span>}
              <span
                style={{
                  textDecoration: item.status === 'done' ? 'line-through' : 'none',
                  color: item.status === 'done' ? 'var(--muted)' : 'inherit',
                }}
              >
                {item.name}
              </span>
            </span>
            <span
              className="muted"
              style={{ fontSize: '0.8rem', whiteSpace: 'nowrap' }}
            >
              {statusLabel(item)} · ~{item.estimate_minutes}m
            </span>
          </li>
        ))}
      </ul>
      {plan.swap_pool.length > 0 && (
        <div style={{ marginTop: '0.75rem' }}>
          <strong style={{ fontSize: '0.9rem' }}>Deferred to swap pool</strong>
          <ul style={{ listStyle: 'none', padding: 0, margin: '0.3rem 0 0 0' }}>
            {plan.swap_pool.map((p) => (
              <li
                key={p.routine_key}
                className="muted"
                style={{ fontSize: '0.88rem', padding: '0.25rem 0' }}
              >
                {p.name} · reason: {p.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function statusLabel(item: PlanItem): string {
  switch (item.status) {
    case 'done':
      return 'done';
    case 'deferred':
      return 'deferred';
    case 'in_progress':
      return 'in progress';
    default:
      return 'pending';
  }
}

function ForecastPanel({ forecast }: { forecast: ScheduleRoutineDue[] }) {
  return (
    <div className="panel">
      <strong>Forecast</strong>
      <p className="muted" style={{ marginTop: '0.25rem', fontSize: '0.86rem' }}>
        What would be due this day at current `last_done` values. Read-only —
        the real plan is built when morning-gen runs.
      </p>
      {forecast.length === 0 ? (
        <div className="muted" style={{ marginTop: '0.5rem' }}>
          Nothing due that day.
        </div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: '0.5rem 0 0 0' }}>
          {forecast.map((r) => (
            <li
              key={`${r.source}-${r.routine_key}`}
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: '0.5rem',
                padding: '0.4rem 0',
                borderBottom: '1px solid var(--border)',
              }}
            >
              <span
                className="muted"
                style={{
                  fontSize: '0.7rem',
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  border: '1px solid var(--border)',
                  borderRadius: '3px',
                  padding: '0.05rem 0.35rem',
                  minWidth: '4.5rem',
                  textAlign: 'center',
                  fontWeight: 600,
                }}
              >
                {sourceLabel(r.source)}
              </span>
              <span style={{ flex: 1 }}>{r.name}</span>
              <span
                className="muted"
                style={{
                  fontSize: '0.78rem',
                  fontVariantNumeric: 'tabular-nums',
                  whiteSpace: 'nowrap',
                }}
              >
                {r.cadence_note} · ~{r.estimate_minutes}m
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function sourceLabel(s: ScheduleRoutineDue['source']): string {
  switch (s) {
    case 'rolling':
      return 'Rolling';
    case 'fixed':
      return 'Fixed';
    case 'zone_rotation':
      return 'Zone';
    case 'event_driven':
      return 'Event';
  }
}

function DayEventsPanel({
  events,
  dateStr,
}: {
  events: CalendarEvent[];
  dateStr: string;
}) {
  if (events.length === 0) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  const url =
    y && m && d
      ? `https://calendar.google.com/calendar/u/0/r/day/${y}/${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}`
      : 'https://calendar.google.com/';
  return (
    <div className="panel">
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: '0.5rem',
        }}
      >
        <strong>Calendar</strong>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="muted"
          style={{ fontSize: '0.82rem' }}
        >
          Open in Google Calendar →
        </a>
      </div>
      <ul style={{ listStyle: 'none', padding: 0, margin: '0.5rem 0 0 0' }}>
        {events.map((e) => (
          <li
            key={e.id}
            style={{
              padding: '0.4rem 0',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'baseline',
              gap: '0.75rem',
            }}
          >
            <span
              className="muted"
              style={{
                fontSize: '0.78rem',
                fontVariantNumeric: 'tabular-nums',
                minWidth: '5.5rem',
              }}
            >
              {e.is_all_day ? 'All day' : TIME_FMT.format(new Date(e.start))}
            </span>
            <span>{e.summary}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TasksPanel({
  tasks,
  isToday,
  onTaskUpdate,
}: {
  tasks: CalendarTask[];
  isToday: boolean;
  onTaskUpdate: (task: CalendarTask) => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(t: CalendarTask) {
    setBusyId(t.id);
    setError(null);
    try {
      const updated =
        t.status === 'completed'
          ? await api.tasks.uncomplete(t.tasklist_id, t.id)
          : await api.tasks.complete(t.tasklist_id, t.id);
      onTaskUpdate(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="panel">
      <strong>Google Tasks</strong>
      <p className="muted" style={{ marginTop: '0.25rem', fontSize: '0.86rem' }}>
        Items from Google Tasks due that day. Check them off here and the
        change writes back to Google.
      </p>
      <ul style={{ listStyle: 'none', padding: 0, margin: '0.5rem 0 0 0' }}>
        {tasks.map((t) => {
          const done = t.status === 'completed';
          return (
            <li
              key={t.id}
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: '0.6rem',
                padding: '0.45rem 0',
                borderBottom: '1px solid var(--border)',
              }}
            >
              <input
                type="checkbox"
                checked={done}
                disabled={!isToday || busyId === t.id}
                onChange={() => toggle(t)}
                title={
                  !isToday
                    ? 'Toggling tasks is only enabled for today'
                    : undefined
                }
              />
              <span
                style={{
                  flex: 1,
                  textDecoration: done ? 'line-through' : 'none',
                  color: done ? 'var(--muted)' : 'inherit',
                }}
              >
                {t.title}
                {t.notes && (
                  <div
                    className="muted"
                    style={{ fontSize: '0.8rem', marginTop: '0.15rem' }}
                  >
                    {t.notes}
                  </div>
                )}
              </span>
              {busyId === t.id && (
                <span className="muted" style={{ fontSize: '0.78rem' }}>
                  Saving…
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {error && (
        <div
          style={{
            marginTop: '0.5rem',
            fontSize: '0.85rem',
            color: 'var(--bad)',
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}

function DayContextPanel({ entries }: { entries: ContextEntry[] }) {
  return (
    <div
      className="panel"
      style={{ borderLeft: '3px solid var(--accent)', paddingLeft: '0.75rem' }}
    >
      <strong>Context</strong>
      <ul style={{ listStyle: 'none', padding: 0, margin: '0.4rem 0 0 0' }}>
        {entries.map((e) => (
          <li
            key={String(e._id)}
            style={{ padding: '0.3rem 0', fontSize: '0.9rem' }}
          >
            <div style={{ whiteSpace: 'pre-wrap' }}>{e.text}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}
