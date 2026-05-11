import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import sampleMealWeek from '@household-os/shared/sample-meal-week.json' with { type: 'json' };
import type { MealDay, MealEffort, MealWeek } from '@household-os/shared/types';

/**
 * Phase 3.5 — Meal week calendar for the Food tab. Displays a meal week
 * (Monday–Sunday) with a day-pill strip + recipe panel for the selected
 * day. Data is paste-ingested from the Grocery Manager persona running on
 * claude.ai (it emits a "MEAL WEEK JSON" block per its system prompt).
 *
 * Week navigation walks by exactly 7 days. Empty weeks render an empty
 * state with the paste-JSON admin still available, so Diane can populate
 * any Monday she lands on.
 *
 * Warm cream/terracotta palette is scoped under `.meal-cal` (see styles.css)
 * so it doesn't bleed into other tabs.
 */

const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseYmd(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function startOfWeek(d: Date): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const daysSinceMonday = (r.getDay() + 6) % 7;
  r.setDate(r.getDate() - daysSinceMonday);
  return r;
}

function shiftDays(s: string, days: number): string {
  const d = parseYmd(s);
  if (!d) return s;
  d.setDate(d.getDate() + days);
  return ymd(d);
}

const RANGE_FMT = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
});
const RANGE_FMT_WITH_YEAR = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

function formatWeekRange(startDate: string): string {
  const start = parseYmd(startDate);
  if (!start) return startDate;
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const sameYear = start.getFullYear() === end.getFullYear();
  return sameYear
    ? `${RANGE_FMT.format(start)} – ${RANGE_FMT_WITH_YEAR.format(end)}`
    : `${RANGE_FMT_WITH_YEAR.format(start)} – ${RANGE_FMT_WITH_YEAR.format(end)}`;
}

function badgeClassFor(effort: MealEffort): string {
  return effort === 'cook'
    ? 'badge-cook'
    : effort === 'easy'
      ? 'badge-easy'
      : 'badge-grab';
}

function shortEffortLabel(label: string): string {
  // Strip the trailing word(s) — show only the leading emoji or first token.
  // Falls back to capitalized 'cook'/'easy'/'grab' if no emoji.
  const trimmed = label.trim();
  const firstToken = trimmed.split(' ')[0] ?? trimmed;
  return firstToken;
}

export default function MealWeekCalendar() {
  const today = ymd(new Date());
  const initialStart = ymd(startOfWeek(new Date()));
  const [startDate, setStartDate] = useState(initialStart);
  const [week, setWeek] = useState<MealWeek | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [activeDay, setActiveDay] = useState(0);

  const load = useCallback(async (start: string) => {
    setLoaded(false);
    try {
      const w = await api.mealWeeks.get(start);
      setWeek(w);
    } catch {
      // 404 from API — no week for this Monday yet
      setWeek(null);
    } finally {
      setLoaded(true);
      setActiveDay(0);
    }
  }, []);

  useEffect(() => {
    void load(startDate);
  }, [load, startDate]);

  const meals = week?.meals ?? [];
  const active = meals[activeDay];

  function goPrev() {
    setStartDate((s) => shiftDays(s, -7));
  }
  function goNext() {
    setStartDate((s) => shiftDays(s, 7));
  }
  function goToday() {
    setStartDate(ymd(startOfWeek(new Date())));
  }

  return (
    <section className="meal-cal">
      <header className="meal-cal-head">
        <div className="meal-cal-eyebrow">
          Week of {formatWeekRange(startDate)}
        </div>
        <h2 className="meal-cal-title">
          Diane's <em>Meal Week</em>
        </h2>
        <div className="meal-cal-divider" />
        <p className="meal-cal-subtitle">
          Click any day to see the meal + how to make it
        </p>
      </header>

      <div className="meal-cal-weeknav">
        <button onClick={goPrev} type="button">
          ← Previous
        </button>
        <span className="meal-cal-weekrange">{formatWeekRange(startDate)}</span>
        <button
          onClick={goNext}
          type="button"
          disabled={shiftDays(startDate, 7) > shiftDays(today, 365)}
        >
          Next →
        </button>
      </div>

      {startDate !== ymd(startOfWeek(new Date())) && (
        <div
          style={{
            textAlign: 'center',
            marginTop: '-0.6rem',
            marginBottom: '0.8rem',
          }}
        >
          <button
            type="button"
            onClick={goToday}
            style={{
              background: 'transparent',
              border: 0,
              color: 'var(--mc-terracotta)',
              fontSize: '0.78rem',
              cursor: 'pointer',
              padding: 0,
            }}
          >
            Jump to this week →
          </button>
        </div>
      )}

      <WeekStrip
        startDate={startDate}
        meals={meals}
        activeDay={activeDay}
        onSelect={setActiveDay}
      />

      {!loaded ? (
        <div className="meal-cal-empty">Loading…</div>
      ) : !week || meals.length === 0 ? (
        <EmptyWeek startDate={startDate} onSaved={() => load(startDate)} />
      ) : (
        active && (
          <RecipePanel
            meal={active}
            index={activeDay}
            total={meals.length}
            onPrev={() => setActiveDay((i) => Math.max(0, i - 1))}
            onNext={() =>
              setActiveDay((i) => Math.min(meals.length - 1, i + 1))
            }
          />
        )
      )}

      <PasteAdmin
        defaultStartDate={startDate}
        onSaved={() => load(startDate)}
      />
    </section>
  );
}

// ---------- Week strip ----------

interface WeekStripProps {
  startDate: string;
  meals: MealDay[];
  activeDay: number;
  onSelect: (i: number) => void;
}

function WeekStrip({ startDate, meals, activeDay, onSelect }: WeekStripProps) {
  const start = parseYmd(startDate);
  return (
    <div className="meal-cal-strip">
      {DAY_SHORT.map((label, i) => {
        const dayDate = start ? new Date(start) : null;
        if (dayDate) dayDate.setDate(dayDate.getDate() + i);
        const num = dayDate?.getDate() ?? i + 1;
        const meal = meals[i];
        const isActive = i === activeDay && !!meal;
        const empty = !meal;
        const className = [
          'meal-cal-pill',
          isActive ? 'active' : '',
          empty ? 'empty' : '',
        ]
          .filter(Boolean)
          .join(' ');
        return (
          <button
            key={i}
            type="button"
            className={className}
            onClick={() => meal && onSelect(i)}
            disabled={empty}
            aria-label={`${label} ${num}${meal ? ': ' + meal.title : ''}`}
          >
            <div className="pill-day">{label}</div>
            <div className="pill-num">{num}</div>
            {meal ? (
              <>
                <div className="pill-dot" />
                <div className={`pill-badge ${badgeClassFor(meal.effort)}`}>
                  {shortEffortLabel(meal.effort_label)}
                </div>
              </>
            ) : (
              <div
                className="pill-dot"
                style={{ background: 'var(--mc-border)' }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

// ---------- Recipe panel ----------

interface RecipePanelProps {
  meal: MealDay;
  index: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}

function RecipePanel({ meal, index, total, onPrev, onNext }: RecipePanelProps) {
  return (
    <div className="meal-cal-recipe">
      <div className="meal-cal-recipe-head">
        <div className="meal-cal-recipe-day">{meal.day}</div>
        <div className="meal-cal-recipe-title">{meal.title}</div>
        <div className="meal-cal-recipe-meta">
          <span className="meta-chip">⏱ {meal.time}</span>
          <span className="meta-chip">💪 {meal.protein}</span>
          <span className="meta-chip">🍽 {meal.servings}</span>
        </div>
      </div>
      <div className="meal-cal-recipe-body">
        <div>
          <div className="meal-cal-section-label">Ingredients</div>
          <ul className="meal-cal-ing">
            {meal.ingredients.map((ing, i) => (
              <li key={i}>
                <span className="meal-cal-ing-dot" />
                <span>{ing}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="meal-cal-section-label">How to Make It</div>
          <ol className="meal-cal-steps">
            {meal.steps.map((s, i) => (
              <li key={i}>
                <span className="meal-cal-step-num">{i + 1}</span>
                <span>{s}</span>
              </li>
            ))}
          </ol>
        </div>
        {meal.note && (
          <div className="meal-cal-note">
            <strong>💡 Note:</strong> {meal.note}
          </div>
        )}
      </div>
      <div className="meal-cal-daynav">
        <button type="button" onClick={onPrev} disabled={index === 0}>
          ← Previous
        </button>
        <span className="center">
          {index + 1} of {total}
        </span>
        <button
          type="button"
          onClick={onNext}
          disabled={index === total - 1}
        >
          Next →
        </button>
      </div>
    </div>
  );
}

// ---------- Empty state ----------

function EmptyWeek({
  startDate,
  onSaved,
}: {
  startDate: string;
  onSaved: () => void;
}) {
  return (
    <div className="meal-cal-empty">
      <div style={{ fontSize: '1rem', marginBottom: '0.4rem' }}>
        No meal plan for this week yet.
      </div>
      <div style={{ fontSize: '0.85rem' }}>
        Ask Grocery Manager for a plan, then paste the JSON block below.
      </div>
      <div style={{ marginTop: '0.6rem', fontSize: '0.78rem' }}>
        Start date will save as <strong>{startDate}</strong>.
      </div>
      <div style={{ marginTop: '0.5rem', display: 'none' }}>
        {/* hidden — placeholder ensures onSaved isn't an unused prop */}
        <button onClick={onSaved} />
      </div>
    </div>
  );
}

// ---------- Paste-JSON admin ----------

interface PasteAdminProps {
  defaultStartDate: string;
  onSaved: () => void;
}

function PasteAdmin({ defaultStartDate, onSaved }: PasteAdminProps) {
  const [text, setText] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  function loadSample() {
    setText(JSON.stringify(sampleMealWeek, null, 2));
    setMsg(null);
  }

  /**
   * GM's JSON block can be wrapped in fences or prefixed with a "MEAL WEEK
   * JSON" header per the persona prompt. Strip those so Diane can paste the
   * whole thing without manual cleanup.
   */
  function extractJson(raw: string): string {
    let s = raw.trim();
    // Drop fenced code blocks if present
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '');
    // Drop the "MEAL WEEK JSON" header line if present
    s = s.replace(/^MEAL WEEK JSON\s*/i, '');
    return s.trim();
  }

  async function save() {
    setMsg(null);
    setSaving(true);
    try {
      const cleaned = extractJson(text);
      const parsed = JSON.parse(cleaned) as {
        start_date?: string;
        title?: string;
        meals?: unknown[];
      };
      if (!parsed.start_date) {
        parsed.start_date = defaultStartDate;
      }
      if (!Array.isArray(parsed.meals) || parsed.meals.length === 0) {
        throw new Error('JSON must include a non-empty "meals" array');
      }
      await api.mealWeeks.upsert({
        start_date: parsed.start_date,
        title: parsed.title,
        meals: parsed.meals,
      });
      setMsg({
        ok: true,
        text: `Saved meal week ${parsed.start_date}.`,
      });
      setText('');
      onSaved();
    } catch (err) {
      setMsg({
        ok: false,
        text:
          err instanceof Error
            ? err.message.replace(/^[\d]+ /, '')
            : 'Save failed',
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <details className="meal-cal-admin">
      <summary>Paste a meal week (from Grocery Manager) ▾</summary>
      <p
        style={{
          fontSize: '0.78rem',
          color: 'var(--mc-warm-gray)',
          marginTop: '0.6rem',
          marginBottom: 0,
        }}
      >
        Paste the <code>MEAL WEEK JSON</code> block Grocery Manager produces.
        If <code>start_date</code> is missing it defaults to{' '}
        <strong>{defaultStartDate}</strong>.
      </p>
      <textarea
        rows={8}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder='{ "start_date": "2026-05-11", "meals": [ … ] }'
      />
      <div className="admin-row">
        <button onClick={save} disabled={saving || !text.trim()} type="button">
          {saving ? 'Saving…' : 'Save week'}
        </button>
        <button onClick={loadSample} type="button" className="ghost">
          Load sample (May 11)
        </button>
        {text && (
          <button
            onClick={() => {
              setText('');
              setMsg(null);
            }}
            type="button"
            className="ghost"
          >
            Clear
          </button>
        )}
      </div>
      {msg && (
        <div className={`admin-msg ${msg.ok ? 'ok' : 'bad'}`}>{msg.text}</div>
      )}
    </details>
  );
}
