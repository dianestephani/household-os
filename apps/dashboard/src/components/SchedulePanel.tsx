import { useEffect, useState } from 'react';
import { api } from '../api.js';
import type {
  CalendarEvent,
  ScheduleEntry,
  ScheduleRangeResponse,
  ScheduleRoutineDue,
} from '@household-os/shared/types';

type Range = 'week' | 'month';

const DAYS: Record<Range, number> = { week: 7, month: 30 };

const TIME_FMT = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
});

const DAY_HEADER_FMT = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});

function formatTime(event: CalendarEvent): string {
  if (event.is_all_day) return 'All day';
  return TIME_FMT.format(new Date(event.start));
}

function formatDayHeader(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return date;
  return DAY_HEADER_FMT.format(new Date(y, m - 1, d));
}

function sourceBadge(source: ScheduleRoutineDue['source']): string {
  switch (source) {
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

export default function SchedulePanel() {
  const [range, setRange] = useState<Range>('week');
  const [data, setData] = useState<ScheduleRangeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    void (async () => {
      try {
        setData(await api.schedule.range(DAYS[range]));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, [range]);

  return (
    <>
      <div className="panel">
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: '0.5rem',
            flexWrap: 'wrap',
          }}
        >
          <div>
            <strong>Schedule</strong>{' '}
            <span className="muted" style={{ fontSize: '0.85rem' }}>
              · looking ahead {DAYS[range]} days
            </span>
          </div>
          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
            <RangeButton current={range} value="week" onClick={setRange}>
              Week
            </RangeButton>
            <RangeButton current={range} value="month" onClick={setRange}>
              Month
            </RangeButton>
            {data && (
              <a
                href={data.open_in_calendar_url}
                target="_blank"
                rel="noopener noreferrer"
                className="muted"
                style={{ fontSize: '0.82rem', marginLeft: '0.25rem' }}
              >
                Google Calendar →
              </a>
            )}
          </div>
        </div>
        {!data?.calendar_connected && data && (
          <div
            className="muted"
            style={{
              marginTop: '0.6rem',
              fontSize: '0.86rem',
              padding: '0.45rem 0.6rem',
              border: '1px dashed var(--border)',
              borderRadius: '6px',
            }}
          >
            Calendar not connected — only routines will appear. Run{' '}
            <code style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>
              npm -w @household-os/api run google-auth
            </code>{' '}
            to connect.
          </div>
        )}
      </div>

      {error && (
        <div className="panel" style={{ borderColor: 'var(--bad)' }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {!data && !error && <div className="muted">Loading…</div>}

      {data && data.pending_adhoc_tasks.length > 0 && (
        <div className="panel">
          <strong>Open ad-hoc tasks</strong>
          <p className="muted" style={{ marginTop: '0.25rem', fontSize: '0.86rem' }}>
            Not date-anchored — pulled in as energy allows.
          </p>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {data.pending_adhoc_tasks.map((t) => (
              <li
                key={t.id}
                style={{
                  padding: '0.45rem 0',
                  borderBottom: '1px solid var(--border)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  gap: '0.5rem',
                }}
              >
                <span>{t.name}</span>
                <span
                  className="muted"
                  style={{
                    fontSize: '0.78rem',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {t.zone} · {t.severity} · ~{t.estimate_minutes}m
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data && (
        <div className="panel" style={{ padding: '0.5rem 1.25rem' }}>
          {data.days.map((day) => (
            <DayRow key={day.date} day={day} compact={range === 'month'} />
          ))}
        </div>
      )}
    </>
  );
}

function RangeButton({
  value,
  current,
  onClick,
  children,
}: {
  value: Range;
  current: Range;
  onClick: (v: Range) => void;
  children: React.ReactNode;
}) {
  const active = value === current;
  return (
    <button
      type="button"
      data-variant="ghost"
      onClick={() => onClick(value)}
      style={{
        padding: '0.3rem 0.75rem',
        borderRadius: '999px',
        border: '1px solid var(--border)',
        background: active ? 'var(--accent)' : 'var(--panel)',
        color: active ? 'var(--accent-fg)' : 'var(--text)',
        fontSize: '0.82rem',
        letterSpacing: '0.02em',
        fontWeight: 500,
      }}
    >
      {children}
    </button>
  );
}

function DayRow({ day, compact }: { day: ScheduleEntry; compact: boolean }) {
  const isEmpty = day.events.length === 0 && day.routines_due.length === 0;
  if (compact && isEmpty) {
    return (
      <div
        style={{
          padding: '0.4rem 0',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          gap: '0.75rem',
          alignItems: 'baseline',
        }}
      >
        <span
          style={{
            minWidth: '7rem',
            fontWeight: day.is_today ? 600 : 500,
            fontSize: '0.88rem',
          }}
        >
          {formatDayHeader(day.date)}
          {day.is_today && (
            <span className="muted" style={{ fontSize: '0.75rem' }}>
              {' '}
              · today
            </span>
          )}
        </span>
        <span className="muted" style={{ fontSize: '0.82rem' }}>
          —
        </span>
      </div>
    );
  }

  return (
    <div
      style={{
        padding: '0.65rem 0',
        borderBottom: '1px solid var(--border)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: '0.5rem',
          marginBottom: isEmpty ? 0 : '0.4rem',
        }}
      >
        <span
          style={{
            fontWeight: day.is_today ? 600 : 500,
            fontSize: '0.95rem',
          }}
        >
          {formatDayHeader(day.date)}
        </span>
        {day.is_today && (
          <span className="muted" style={{ fontSize: '0.78rem' }}>
            today
          </span>
        )}
        {isEmpty && (
          <span className="muted" style={{ fontSize: '0.82rem' }}>
            — nothing scheduled
          </span>
        )}
      </div>

      {day.events.length > 0 && (
        <ul
          style={{
            listStyle: 'none',
            padding: 0,
            margin: '0 0 0.3rem 0',
            display: 'grid',
            gap: compact ? '0.15rem' : '0.25rem',
          }}
        >
          {day.events.map((e) => {
            const inner = (
              <>
                <span
                  className="muted"
                  style={{
                    fontSize: '0.78rem',
                    fontVariantNumeric: 'tabular-nums',
                    minWidth: '5.5rem',
                    display: 'inline-block',
                  }}
                >
                  {formatTime(e)}
                </span>
                <span style={{ fontSize: '0.9rem' }}>{e.summary}</span>
              </>
            );
            return (
              <li key={e.id} style={{ display: 'flex', gap: '0.5rem' }}>
                {e.html_link ? (
                  <a
                    href={e.html_link}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      textDecoration: 'none',
                      color: 'inherit',
                      display: 'flex',
                      gap: '0.5rem',
                    }}
                  >
                    {inner}
                  </a>
                ) : (
                  inner
                )}
              </li>
            );
          })}
        </ul>
      )}

      {day.routines_due.length > 0 && (
        <ul
          style={{
            listStyle: 'none',
            padding: 0,
            margin: 0,
            display: 'grid',
            gap: compact ? '0.15rem' : '0.25rem',
          }}
        >
          {day.routines_due.map((r) => (
            <li
              key={`${r.source}-${r.routine_key}`}
              style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: '0.5rem',
                fontSize: '0.9rem',
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
                {sourceBadge(r.source)}
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
