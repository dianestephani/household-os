import { useCallback, useEffect, useState } from 'react';
import { api, type AffordabilityReport } from '../api.js';
import { relativeTime } from '../utils/relativeTime.js';
import type {
  ActivityKind,
  ActivityLogEntry,
  CalendarDayResponse,
  ContextEntry,
  TodayPlan,
  WorkoutLog,
  WorkoutPattern,
  WorkoutSlotKey,
} from '@household-os/shared/types';

/**
 * Phase 3 §47 — Home tab. The default landing surface. Each widget is a
 * card that summarizes one subsystem and links out to its full tab. Widgets
 * load independently so a single slow endpoint doesn't block first paint.
 */

type AppView = string;

interface HomePanelProps {
  onNavigate: (view: AppView) => void;
}

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
  finance_import_added: '$',
  finance_snapshot_restored: '↺',
};

/** Rotates through zones so the chip prompt feels fresh day-to-day. */
const ZONE_ROTATION = [
  'kitchen',
  'bathrooms',
  'common',
  'bedroom',
  'yard',
  'whole-house',
] as const;

function todayZone(): (typeof ZONE_ROTATION)[number] {
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 0);
  const doy = Math.floor(
    (now.getTime() - startOfYear.getTime()) / 86_400_000,
  );
  return ZONE_ROTATION[doy % ZONE_ROTATION.length] ?? 'kitchen';
}

function zoneLabel(z: string): string {
  return z.replace(/-/g, ' ');
}

export default function HomePanel({ onNavigate }: HomePanelProps) {
  return (
    <div className="widget-grid">
      <TodayWidget onNavigate={onNavigate} />
      <CalendarWidget onNavigate={onNavigate} />
      <WorkoutsWidget onNavigate={onNavigate} />
      <FinanceWidget onNavigate={onNavigate} />
      <ActivityWidget onNavigate={onNavigate} />
      <JournalWidget onNavigate={onNavigate} />
      <ZoneChipWidget />
    </div>
  );
}

// ---------- Today summary ----------

function TodayWidget({ onNavigate }: HomePanelProps) {
  const [plan, setPlan] = useState<TodayPlan | null>(null);
  const [tick, setTick] = useState(0);

  const load = useCallback(async () => {
    setPlan(null);
    try {
      setPlan(await api.today.get());
    } catch {
      setPlan(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, tick]);

  const items = plan?.items ?? [];
  const done = items.filter((i) => i.status === 'done').length;
  const total = items.length;
  const incomplete = items
    .filter((i) => i.status !== 'done')
    .slice(0, 2);

  return (
    <div className="widget full-width">
      <div className="widget-head">
        <strong>Today</strong>
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'baseline' }}>
          <button
            className="widget-refresh"
            onClick={() => setTick((t) => t + 1)}
            aria-label="Refresh"
            title="Refresh"
          >
            ↻
          </button>
          <button className="widget-link" onClick={() => onNavigate('today')}>
            Open today →
          </button>
        </div>
      </div>
      {!plan ? (
        <Skeleton lines={2} />
      ) : total === 0 ? (
        <div className="widget-empty">
          <span>No items on today's plan yet.</span>
          <button
            className="empty-cta"
            onClick={() => onNavigate('today')}
            type="button"
          >
            Open today →
          </button>
        </div>
      ) : (
        <>
          <div style={{ fontSize: '0.95rem' }}>
            <strong>
              {done} of {total}
            </strong>{' '}
            <span className="muted">done</span>
          </div>
          {incomplete.length > 0 && (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {incomplete.map((i) => (
                <li
                  key={i.routine_key}
                  style={{
                    padding: '0.3rem 0',
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: '0.5rem',
                    fontSize: '0.88rem',
                  }}
                >
                  <span>{i.name}</span>
                  <span className="muted" style={{ fontSize: '0.8rem' }}>
                    {i.estimate_minutes} min · {i.energy}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

// ---------- Calendar today ----------

function CalendarWidget({ onNavigate }: HomePanelProps) {
  const [data, setData] = useState<CalendarDayResponse | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    setData(null);
    void api.calendar.today().then(setData).catch(() => setData(null));
  }, [tick]);

  return (
    <div className="widget">
      <div className="widget-head">
        <strong>Calendar</strong>
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'baseline' }}>
          <button
            className="widget-refresh"
            onClick={() => setTick((t) => t + 1)}
            aria-label="Refresh"
          >
            ↻
          </button>
          <button
            className="widget-link"
            onClick={() => onNavigate('schedule')}
          >
            Schedule →
          </button>
        </div>
      </div>
      {!data ? (
        <Skeleton lines={2} />
      ) : !data.connected ? (
        <div className="widget-empty">
          <span>Calendar not connected.</span>
          <span className="muted" style={{ fontSize: '0.78rem' }}>
            Run <code>npm -w @household-os/api run google-auth</code>.
          </span>
        </div>
      ) : data.events.length === 0 ? (
        <div className="widget-empty">
          <span>Nothing scheduled today.</span>
        </div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {data.events.slice(0, 3).map((e) => (
            <li
              key={e.id}
              style={{
                padding: '0.3rem 0',
                fontSize: '0.85rem',
                display: 'flex',
                justifyContent: 'space-between',
                gap: '0.5rem',
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {e.summary}
              </span>
              <span className="muted" style={{ fontSize: '0.78rem', whiteSpace: 'nowrap' }}>
                {e.is_all_day
                  ? 'All day'
                  : new Date(e.start).toLocaleTimeString([], {
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
              </span>
            </li>
          ))}
          {data.events.length > 3 && (
            <li className="muted" style={{ fontSize: '0.78rem', padding: '0.25rem 0' }}>
              +{data.events.length - 3} more
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

// ---------- Workouts ----------

function WorkoutsWidget({ onNavigate }: HomePanelProps) {
  const [data, setData] = useState<{
    today: {
      slot: { slot_key: WorkoutSlotKey; name: string; type: string } | null;
      log: WorkoutLog | null;
    } | null;
    pattern: WorkoutPattern | null;
  }>({ today: null, pattern: null });
  const [tick, setTick] = useState(0);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setLoaded(false);
    void Promise.all([
      api.workouts.today().catch(() => null),
      api.patterns.workouts(7).catch(() => null),
    ]).then(([today, pattern]) => {
      setData({ today, pattern });
      setLoaded(true);
    });
  }, [tick]);

  return (
    <div className="widget">
      <div className="widget-head">
        <strong>Workouts</strong>
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'baseline' }}>
          <button
            className="widget-refresh"
            onClick={() => setTick((t) => t + 1)}
            aria-label="Refresh"
          >
            ↻
          </button>
          <button
            className="widget-link"
            onClick={() => onNavigate('workouts')}
          >
            Open →
          </button>
        </div>
      </div>
      {!loaded ? (
        <Skeleton lines={2} />
      ) : (
        <>
          {data.pattern && (
            <div style={{ fontSize: '0.92rem' }}>
              This week:{' '}
              <strong>
                {data.pattern.done} of {data.pattern.scheduled}
              </strong>{' '}
              <span className="muted">done</span>
              {data.pattern.skipped > 0 && (
                <span className="muted">
                  {' '}
                  · {data.pattern.skipped} skipped
                </span>
              )}
            </div>
          )}
          {data.today?.slot ? (
            <div style={{ fontSize: '0.85rem' }} className="muted">
              Today's slot: <strong style={{ color: 'var(--text)' }}>
                {data.today.slot.name}
              </strong>
              {data.today.log && (
                <> — <span style={{ color: 'var(--good)' }}>logged ({data.today.log.status})</span></>
              )}
            </div>
          ) : (
            <div style={{ fontSize: '0.85rem' }} className="muted">
              No workout scheduled today.
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------- Finance ----------

function FinanceWidget({ onNavigate }: HomePanelProps) {
  const [data, setData] = useState<AffordabilityReport | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    setData(null);
    void api.finance.affordability().then(setData).catch(() => setData(null));
  }, [tick]);

  const exceedsTop2 = data?.exceeds_discretionary.slice(0, 2) ?? [];

  return (
    <div className="widget">
      <div className="widget-head">
        <strong>Finance</strong>
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'baseline' }}>
          <button
            className="widget-refresh"
            onClick={() => setTick((t) => t + 1)}
            aria-label="Refresh"
          >
            ↻
          </button>
          <button className="widget-link" onClick={() => onNavigate('finance')}>
            Open →
          </button>
        </div>
      </div>
      {!data ? (
        <Skeleton lines={2} />
      ) : data.discretionary_monthly === 0 ? (
        <div className="widget-empty">
          <span>No discretionary set yet.</span>
          <button
            className="empty-cta"
            onClick={() => onNavigate('finance')}
            type="button"
          >
            Fill in profile →
          </button>
        </div>
      ) : (
        <>
          <div style={{ fontSize: '0.95rem' }}>
            <strong>${data.discretionary_monthly.toFixed(0)}/mo</strong>{' '}
            <span className="muted">discretionary</span>
          </div>
          {exceedsTop2.length > 0 && (
            <div style={{ fontSize: '0.82rem' }} className="muted">
              Not yet covered: {exceedsTop2.map((i) => i.routine_name).join(', ')}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------- Recent activity ticker ----------

function ActivityWidget({ onNavigate }: HomePanelProps) {
  const [entries, setEntries] = useState<ActivityLogEntry[] | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    setEntries(null);
    void api.activity
      .list(3)
      .then((all) => setEntries(all.slice(0, 6)))
      .catch(() => setEntries([]));
  }, [tick]);

  return (
    <div className="widget full-width">
      <div className="widget-head">
        <strong>Recent activity</strong>
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'baseline' }}>
          <button
            className="widget-refresh"
            onClick={() => setTick((t) => t + 1)}
            aria-label="Refresh"
          >
            ↻
          </button>
          <button className="widget-link" onClick={() => onNavigate('log')}>
            Open log →
          </button>
        </div>
      </div>
      {!entries ? (
        <Skeleton lines={3} />
      ) : entries.length === 0 ? (
        <div className="widget-empty">
          <span>No activity in the last 3 days.</span>
        </div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {entries.map((e) => (
            <li
              key={String(e._id ?? `${e.ts}-${e.summary}`)}
              style={{
                padding: '0.32rem 0',
                display: 'flex',
                gap: '0.55rem',
                alignItems: 'baseline',
                fontSize: '0.86rem',
                borderBottom: '1px solid var(--border)',
              }}
            >
              <span
                aria-hidden
                style={{
                  color: 'var(--muted)',
                  width: '1.3rem',
                  display: 'inline-block',
                  textAlign: 'center',
                }}
              >
                {KIND_ICON[e.kind] ?? '·'}
              </span>
              <span style={{ flex: 1 }}>{e.summary}</span>
              <span
                className="muted"
                style={{
                  fontSize: '0.78rem',
                  whiteSpace: 'nowrap',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {relativeTime(e.ts)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------- Journal/context strip ----------

function JournalWidget({ onNavigate }: HomePanelProps) {
  const [entries, setEntries] = useState<ContextEntry[] | null>(null);
  const [tick, setTick] = useState(0);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setEntries(null);
    void api.context.today().then(setEntries).catch(() => setEntries([]));
  }, [tick]);

  async function save() {
    if (!draft.trim()) return;
    setSaving(true);
    try {
      await api.context.add({ text: draft.trim(), source: 'dashboard' });
      setDraft('');
      setQuickAddOpen(false);
      setTick((t) => t + 1);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="widget">
      <div className="widget-head">
        <strong>Today's journal</strong>
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'baseline' }}>
          <button
            className="widget-link"
            onClick={() => setQuickAddOpen((v) => !v)}
            aria-label="Quick add journal entry"
            title="Quick add"
          >
            {quickAddOpen ? '×' : '+'}
          </button>
          <button className="widget-link" onClick={() => onNavigate('log')}>
            Full log →
          </button>
        </div>
      </div>
      {quickAddOpen && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          <textarea
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Today is…"
            style={{ fontSize: '0.88rem' }}
          />
          <button
            onClick={save}
            disabled={saving || !draft.trim()}
            style={{
              alignSelf: 'flex-start',
              background: 'var(--accent)',
              color: 'var(--accent-fg)',
              border: '1px solid var(--accent)',
              borderRadius: 6,
              padding: '0.35rem 0.85rem',
              fontSize: '0.85rem',
            }}
            type="button"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
      {!entries ? (
        <Skeleton lines={2} />
      ) : entries.length === 0 ? (
        <div className="widget-empty">
          <span>No journal entries today.</span>
        </div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {entries.slice(0, 3).map((e) => (
            <li
              key={String(e._id ?? e.ts)}
              style={{
                padding: '0.3rem 0',
                fontSize: '0.85rem',
                borderBottom: '1px solid var(--border)',
              }}
            >
              {e.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------- Zone assessment chip ----------

function ZoneChipWidget() {
  const [zone] = useState<string>(todayZone());
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function assess(level: 'fine' | 'meh' | 'rough') {
    setBusy(true);
    try {
      const out = await api.zones.assess(zone, level);
      const taskCount = out.tasks?.length ?? 0;
      setResult(
        level === 'fine'
          ? `Logged "${zone}" as fine.`
          : `Logged "${zone}" as ${level}. ${taskCount} task${
              taskCount === 1 ? '' : 's'
            } added.`,
      );
    } catch (err) {
      setResult(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="widget">
      <div className="widget-head">
        <strong>Zone check</strong>
        <span className="muted" style={{ fontSize: '0.78rem' }}>
          Quick pulse
        </span>
      </div>
      <div style={{ fontSize: '0.92rem' }}>
        How's the <strong>{zoneLabel(zone)}</strong> looking right now?
      </div>
      <div style={{ display: 'flex', gap: '0.4rem' }}>
        {(['fine', 'meh', 'rough'] as const).map((lvl) => (
          <button
            key={lvl}
            onClick={() => assess(lvl)}
            disabled={busy}
            type="button"
            style={{
              flex: 1,
              padding: '0.4rem 0.5rem',
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: 'var(--panel)',
              color: 'var(--text)',
              fontSize: '0.85rem',
              textTransform: 'capitalize',
            }}
          >
            {lvl}
          </button>
        ))}
      </div>
      {result && (
        <div className="muted" style={{ fontSize: '0.8rem' }}>
          {result}
        </div>
      )}
    </div>
  );
}

// ---------- Shared skeleton ----------

function Skeleton({ lines = 2 }: { lines?: number }) {
  const widths: ('short' | 'med' | 'long')[] = ['long', 'med', 'short'];
  return (
    <div aria-hidden>
      {Array.from({ length: lines }).map((_, i) => (
        <span key={i} className={`skeleton ${widths[i % widths.length]}`} />
      ))}
    </div>
  );
}
