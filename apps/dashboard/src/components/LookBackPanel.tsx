import { useEffect, useState } from 'react';
import { api, type LookBackPattern } from '../api.js';
import type {
  FinancialProfile,
  MorningCheckin,
  RocketMoneyImport,
  WorkoutLog,
} from '@household-os/shared/types';

/**
 * §50 Phase D — Look Back. Three read-only stacked sections:
 *
 *   1. This week — workout count vs target (3/week); 7-day morning-checkin
 *      strip rendered as colored dots per pulse.
 *   2. This month — RocketMoney import summary (top categories + total) +
 *      monthly profile rollup (Net = gross − tax − fixed − discretionary).
 *      The "projected income" §50 calls for is `monthly_gross_income` on
 *      FinancialProfile — same monthly figure she enters in Stuff/Finance.
 *      Phase E will revisit if she wants a separate per-month projected
 *      number (vs. the flat monthly figure used today).
 *   3. Patterns — hardcoded detectors from /api/look-back/patterns. Hidden
 *      entirely when the array is empty.
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

const MONTH_FMT = new Intl.DateTimeFormat(undefined, {
  month: 'long',
  day: 'numeric',
});

const CURRENCY_FMT = new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

export default function LookBackPanel() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <ThisWeekSection />
      <ThisMonthSection />
      <PatternsSection />
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

function currentMonthKey(): string {
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${now.getFullYear()}-${m}`;
}

function ThisMonthSection() {
  const [profile, setProfile] = useState<FinancialProfile | null>(null);
  const [latestImport, setLatestImport] = useState<RocketMoneyImport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // §50 Phase E — per-month projected income override. Falls back silently to
  // `monthly_gross_income` if no override is set for the current month.
  const [projectedIncomeSource, setProjectedIncomeSource] =
    useState<'override' | 'gross_fallback' | null>(null);
  const [projectedIncomeAmount, setProjectedIncomeAmount] = useState<number>(0);

  useEffect(() => {
    void (async () => {
      try {
        const [p, imports] = await Promise.all([
          api.finance.profile(),
          api.finance.imports.list(1),
        ]);
        setProfile(p);
        setLatestImport(imports[0] ?? null);

        // Read the current month's projected income directly. The endpoint
        // already does the override-vs-fallback resolution, so the dashboard
        // doesn't have to re-derive it client-side.
        const monthKey = currentMonthKey();
        const projected = await api.finance.projectedIncome.get(monthKey);
        if (projected) {
          setProjectedIncomeAmount(projected.amount);
          setProjectedIncomeSource(projected.source);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="panel">
        <strong>This month</strong>
        <div className="muted" style={{ marginTop: '0.4rem' }}>
          Loading…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="panel">
        <strong>This month</strong>
        <div className="muted" style={{ marginTop: '0.4rem', color: 'var(--bad)' }}>
          {error}
        </div>
      </div>
    );
  }

  const projected =
    projectedIncomeAmount > 0
      ? projectedIncomeAmount
      : profile?.monthly_gross_income ?? 0;
  const tax = profile?.monthly_tax_estimate ?? 0;
  const fixed = profile?.monthly_fixed_expenses ?? 0;
  const discretionarySpent =
    latestImport?.parsed?.total != null ? latestImport.parsed.total : null;
  const net =
    projected > 0 && discretionarySpent !== null
      ? projected - tax - fixed - discretionarySpent
      : null;

  const importDate = latestImport?.ts ? new Date(latestImport.ts) : null;
  const importKindLabel =
    latestImport?.kind === 'csv'
      ? `CSV (${latestImport.filename ?? 'unnamed'})`
      : latestImport?.kind === 'paste'
      ? 'paste'
      : null;

  const topCategories =
    latestImport?.parsed?.categories?.slice().sort((a, b) => b.amount - a.amount).slice(0, 5) ?? [];

  return (
    <div className="panel">
      <strong>This month</strong>

      {/* Profile rollup */}
      <div style={{ marginTop: '0.6rem' }}>
        <div style={{ fontSize: '0.95rem', marginBottom: '0.3rem' }}>
          Monthly profile
        </div>
        {projected === 0 && (
          <div className="muted" style={{ fontSize: '0.85rem' }}>
            Nothing set yet — fill in Stuff → Finance to see the rollup.
          </div>
        )}
        {projected > 0 && (
          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
              fontSize: '0.88rem',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            <RollupRow
              label={
                projectedIncomeSource === 'override'
                  ? 'Projected income (this month)'
                  : 'Projected income'
              }
              amount={projected}
            />
            <RollupRow label="− Tax estimate" amount={-tax} />
            <RollupRow label="− Fixed expenses" amount={-fixed} />
            {discretionarySpent !== null && (
              <RollupRow
                label={`− Discretionary spent (RocketMoney)`}
                amount={-discretionarySpent}
              />
            )}
            {net !== null && <RollupRow label="Net" amount={net} bold />}
          </ul>
        )}
      </div>

      {/* Latest import summary */}
      <div style={{ marginTop: '1rem' }}>
        <div style={{ fontSize: '0.95rem', marginBottom: '0.3rem' }}>
          Latest RocketMoney import
        </div>
        {!latestImport && (
          <div className="muted" style={{ fontSize: '0.85rem' }}>
            No imports yet. Paste or upload one in Stuff → Finance.
          </div>
        )}
        {latestImport && (
          <>
            <div className="muted" style={{ fontSize: '0.82rem' }}>
              {importKindLabel}
              {importDate && ` · ${MONTH_FMT.format(importDate)}`}
              {latestImport.parsed?.total != null && (
                <>
                  {' · total '}
                  {CURRENCY_FMT.format(latestImport.parsed.total)}
                </>
              )}
            </div>
            {topCategories.length > 0 ? (
              <ul
                style={{
                  listStyle: 'none',
                  padding: 0,
                  margin: '0.4rem 0 0 0',
                  fontSize: '0.88rem',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {topCategories.map((cat) => (
                  <li
                    key={cat.name}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: '0.5rem',
                      padding: '0.25rem 0',
                      borderBottom: '1px solid var(--border)',
                    }}
                  >
                    <span>{cat.name}</span>
                    <span>{CURRENCY_FMT.format(cat.amount)}</span>
                  </li>
                ))}
              </ul>
            ) : latestImport.kind === 'paste' ? (
              <div
                className="muted"
                style={{ marginTop: '0.4rem', fontSize: '0.85rem' }}
              >
                Paste imports don't get parsed — open Stuff → Finance to view
                the raw text.
              </div>
            ) : (
              <div
                className="muted"
                style={{ marginTop: '0.4rem', fontSize: '0.85rem' }}
              >
                CSV didn't parse (no matching outflow rows).
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function RollupRow({
  label,
  amount,
  bold,
}: {
  label: string;
  amount: number;
  bold?: boolean;
}) {
  return (
    <li
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: '0.5rem',
        padding: '0.25rem 0',
        borderBottom: '1px solid var(--border)',
        fontWeight: bold ? 600 : 400,
      }}
    >
      <span>{label}</span>
      <span>{CURRENCY_FMT.format(amount)}</span>
    </li>
  );
}

function PatternsSection() {
  const [patterns, setPatterns] = useState<LookBackPattern[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setPatterns(await api.lookBack.patterns(30));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // §50: hide the section entirely when there's nothing notable.
  if (!loading && !error && patterns.length === 0) return null;

  return (
    <div className="panel">
      <strong>Patterns</strong>
      {loading && (
        <div className="muted" style={{ marginTop: '0.4rem' }}>
          Loading…
        </div>
      )}
      {error && (
        <div className="muted" style={{ marginTop: '0.4rem', color: 'var(--bad)' }}>
          {error}
        </div>
      )}
      {patterns.length > 0 && (
        <ul
          style={{
            listStyle: 'none',
            padding: 0,
            margin: '0.5rem 0 0 0',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.4rem',
          }}
        >
          {patterns.map((p) => (
            <li
              key={p.kind}
              style={{
                padding: '0.5rem 0.6rem',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                fontSize: '0.92rem',
              }}
            >
              {p.observation}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
