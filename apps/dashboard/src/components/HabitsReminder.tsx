/**
 * §50 Phase B — static visual nudge for the daily habits that aren't worth
 * tracking as cadence-driven routines. No buttons, no DB writes, no
 * completion checking. Pure reminder.
 *
 * Per §50: "Habits aren't tracked, appointments are." Daily things like
 * litter scoop, sweep, kitchen reset live here. Anything that needs cadence
 * math or a $$ outsource estimate belongs in the Routines table (Stuff).
 */

const HABITS = [
  'Litter scoop',
  'Sweep pet zones',
  'Kitchen reset',
  'Pet food + water',
];

export default function HabitsReminder() {
  return (
    <div className="panel">
      <strong>Daily habits</strong>
      <div
        className="muted"
        style={{ marginTop: '0.25rem', fontSize: '0.82rem' }}
      >
        Reminder only — these aren't tracked.
      </div>
      <ul
        style={{
          listStyle: 'none',
          padding: 0,
          margin: '0.6rem 0 0 0',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.4rem',
        }}
      >
        {HABITS.map((h) => (
          <li
            key={h}
            style={{
              padding: '0.3rem 0.6rem',
              border: '1px solid var(--border)',
              borderRadius: '999px',
              fontSize: '0.9rem',
              background: 'var(--bg-subtle, transparent)',
            }}
          >
            {h}
          </li>
        ))}
      </ul>
    </div>
  );
}
