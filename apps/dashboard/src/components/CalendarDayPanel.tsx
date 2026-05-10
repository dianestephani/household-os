import { useEffect, useState } from 'react';
import { api } from '../api.js';
import type {
  CalendarDayResponse,
  CalendarEvent,
} from '@household-os/shared/types';

const TIME_FMT = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
});

const DAY_FMT = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
});

function formatTimeRange(event: CalendarEvent): string {
  if (event.is_all_day) return 'All day';
  const start = new Date(event.start);
  const end = new Date(event.end);
  return `${TIME_FMT.format(start)} – ${TIME_FMT.format(end)}`;
}

function formatHeaderDate(date: string): string {
  // YYYY-MM-DD → local Date (avoid timezone drift from naive new Date(string))
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return date;
  return DAY_FMT.format(new Date(y, m - 1, d));
}

export default function CalendarDayPanel() {
  const [data, setData] = useState<CalendarDayResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setData(await api.calendar.today());
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, []);

  if (error) {
    return (
      <div className="panel">
        <strong>Calendar</strong>
        <div className="muted" style={{ marginTop: '0.4rem', fontSize: '0.9rem' }}>
          Couldn't load calendar: {error}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="panel">
        <strong>Calendar</strong>
        <div className="muted" style={{ marginTop: '0.4rem' }}>
          Loading…
        </div>
      </div>
    );
  }

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
        <div>
          <strong>Calendar</strong>{' '}
          <span className="muted" style={{ fontSize: '0.85rem' }}>
            · {formatHeaderDate(data.date)}
          </span>
        </div>
        <a
          href={data.open_in_calendar_url}
          target="_blank"
          rel="noopener noreferrer"
          className="muted"
          style={{ fontSize: '0.82rem' }}
        >
          Open in Google Calendar →
        </a>
      </div>

      {!data.connected && (
        <div
          className="muted"
          style={{
            marginTop: '0.6rem',
            fontSize: '0.88rem',
            padding: '0.5rem 0.6rem',
            border: '1px dashed var(--border)',
            borderRadius: '6px',
          }}
        >
          Calendar not connected. Run{' '}
          <code style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>
            npm -w @household-os/api run google-auth
          </code>{' '}
          to connect Google Calendar.
        </div>
      )}

      {data.connected && data.events.length === 0 && (
        <div className="muted" style={{ marginTop: '0.5rem', fontSize: '0.9rem' }}>
          Nothing scheduled today.
        </div>
      )}

      {data.events.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: '0.6rem 0 0 0' }}>
          {data.events.map((e) => {
            const inner = (
              <>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    gap: '0.75rem',
                  }}
                >
                  <span style={{ fontWeight: 500 }}>{e.summary}</span>
                  <span
                    className="muted"
                    style={{
                      fontSize: '0.82rem',
                      whiteSpace: 'nowrap',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {formatTimeRange(e)}
                  </span>
                </div>
                {e.location && (
                  <div
                    className="muted"
                    style={{ fontSize: '0.8rem', marginTop: '0.15rem' }}
                  >
                    {e.location}
                  </div>
                )}
              </>
            );
            return (
              <li
                key={e.id}
                style={{
                  padding: '0.55rem 0',
                  borderBottom: '1px solid var(--border)',
                }}
              >
                {e.html_link ? (
                  <a
                    href={e.html_link}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      textDecoration: 'none',
                      color: 'inherit',
                      display: 'block',
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
    </div>
  );
}
