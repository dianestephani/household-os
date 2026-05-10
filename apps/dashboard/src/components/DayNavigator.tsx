/**
 * Reusable date scroller. Prev/next buttons + native date picker + "Today"
 * pill when off-today. Used by DayPanel, WorkoutPanel, ActivityFeed,
 * JournalPanel — anywhere the user benefits from "what was here on date X /
 * what's planned on date X" navigation.
 *
 * Pure presentational: the parent owns the date state. The format helpers are
 * also exported because callers often need to display the date themselves
 * (e.g. in panel headers) using the same conventions.
 */

const HEADER_FMT = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
});

export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function formatHeader(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return dateStr;
  return HEADER_FMT.format(new Date(y, m - 1, d));
}

export function shiftDate(dateStr: string, deltaDays: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return dateStr;
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + deltaDays);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export default function DayNavigator({
  date,
  onChange,
}: {
  date: string;
  onChange: (date: string) => void;
}) {
  const todayKey = localToday();
  const isToday = date === todayKey;
  return (
    <div
      className="panel"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '0.5rem',
        flexWrap: 'wrap',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <button
          type="button"
          data-variant="ghost"
          onClick={() => onChange(shiftDate(date, -1))}
          aria-label="Previous day"
          style={{
            padding: '0.4rem 0.75rem',
            border: '1px solid var(--border)',
            borderRadius: '6px',
            background: 'var(--panel)',
            color: 'var(--text)',
          }}
        >
          ◀
        </button>
        <input
          type="date"
          value={date}
          onChange={(e) => onChange(e.target.value)}
          style={{ padding: '0.4rem' }}
        />
        <button
          type="button"
          data-variant="ghost"
          onClick={() => onChange(shiftDate(date, 1))}
          aria-label="Next day"
          style={{
            padding: '0.4rem 0.75rem',
            border: '1px solid var(--border)',
            borderRadius: '6px',
            background: 'var(--panel)',
            color: 'var(--text)',
          }}
        >
          ▶
        </button>
      </div>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'baseline' }}>
        <strong style={{ fontSize: '1.05rem' }}>{formatHeader(date)}</strong>
        {!isToday && (
          <button
            type="button"
            data-variant="ghost"
            onClick={() => onChange(todayKey)}
            className="muted"
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: '999px',
              padding: '0.25rem 0.7rem',
              fontSize: '0.78rem',
              fontWeight: 600,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}
          >
            Today
          </button>
        )}
      </div>
    </div>
  );
}
