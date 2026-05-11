import { useEffect, useState } from 'react';
import { api } from './api.js';
import HomePanel from './components/HomePanel.js';
import WorkoutPanel from './components/WorkoutPanel.js';
import LogPanel from './components/LogPanel.js';
import PersonaLauncher from './components/PersonaLauncher.js';
import RoutinesPage from './components/RoutinesPage.js';
import HowToGuide from './components/HowToGuide.js';
import FinancePanel from './components/FinancePanel.js';
import DayPanel from './components/DayPanel.js';
import SchedulePanel from './components/SchedulePanel.js';
import ThemeToggle from './components/ThemeToggle.js';
import LoginScreen from './components/LoginScreen.js';
import {
  AUTH_ENABLED,
  clearSession,
  readSession,
  writeSession,
  type AuthSession,
} from './auth.js';
import type { TodayPlan } from '@household-os/shared/types';

/**
 * Phase 3 §47 — Tab structure refactor.
 *
 * Tabs (6): Home, Today, Schedule, Workouts, Finance, Log
 * Header icons (4): Household Ops (💬), Food (🛒), Routines (⚙️), Guide (❔)
 *
 * Spec called for 3 header icons but didn't account for the existing
 * "Household Ops" persona launcher — it was previously a top-level tab and
 * would have lost its surface entirely. Demoting it to a 4th icon keeps the
 * spec's intent ("demote secondary surfaces to icons") without regressing.
 *
 * `activity` and `journal` from the pre-refactor View union both fold into
 * the new `log` tab; the legacy-localStorage migration in readSavedView()
 * maps them.
 */
type View =
  | 'home'
  | 'today'
  | 'schedule'
  | 'workouts'
  | 'finance'
  | 'log'
  | 'household'
  | 'food'
  | 'routines'
  | 'guide';

const VIEWS: readonly View[] = [
  'home',
  'today',
  'schedule',
  'workouts',
  'finance',
  'log',
  'household',
  'food',
  'routines',
  'guide',
] as const;

/** Pre-refactor view IDs that now map onto the new structure. */
const LEGACY_VIEW_MAP: Record<string, View> = {
  activity: 'log',
  journal: 'log',
};

const VIEW_KEY = 'household-os.view';

function readSavedView(): View {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    if (!v) return 'home';
    if ((VIEWS as readonly string[]).includes(v)) return v as View;
    if (v in LEGACY_VIEW_MAP) return LEGACY_VIEW_MAP[v]!;
  } catch {
    /* localStorage unavailable */
  }
  return 'home';
}

function writeSavedView(view: View): void {
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch {
    /* localStorage unavailable */
  }
}

export default function App() {
  const [view, setViewRaw] = useState<View>(readSavedView);
  const setView = (v: View) => {
    writeSavedView(v);
    setViewRaw(v);
  };
  const [plan, setPlan] = useState<TodayPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<AuthSession | null>(() =>
    AUTH_ENABLED ? readSession() : null,
  );

  async function refresh() {
    try {
      setPlan(await api.today.get());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function handleLogin(s: AuthSession) {
    writeSession(s);
    setSession(s);
  }

  function handleLogout() {
    clearSession();
    setSession(null);
    setPlan(null);
  }

  useEffect(() => {
    if (AUTH_ENABLED && !session) return;
    void refresh();
  }, [session]);

  if (AUTH_ENABLED && !session) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>Household OS</h1>
        <div
          style={{
            display: 'flex',
            gap: '0.4rem',
            alignItems: 'center',
            flexWrap: 'wrap',
            justifyContent: 'flex-end',
          }}
        >
          <button
            type="button"
            className={`header-icon${view === 'household' ? ' active' : ''}`}
            onClick={() => setView('household')}
            title="Open Household Ops persona launcher"
            aria-label="Household Ops"
          >
            <span aria-hidden>💬</span>
            <span className="header-icon-label">Ops</span>
          </button>
          <button
            type="button"
            className={`header-icon${view === 'food' ? ' active' : ''}`}
            onClick={() => setView('food')}
            title="Open Grocery Manager"
            aria-label="Food"
          >
            <span aria-hidden>🛒</span>
            <span className="header-icon-label">Food</span>
          </button>
          <button
            type="button"
            className={`header-icon${view === 'routines' ? ' active' : ''}`}
            onClick={() => setView('routines')}
            title="Manage routines"
            aria-label="Routines"
          >
            <span aria-hidden>⚙️</span>
            <span className="header-icon-label">Routines</span>
          </button>
          <button
            type="button"
            className={`header-icon${view === 'guide' ? ' active' : ''}`}
            onClick={() => setView('guide')}
            title="How-to guide"
            aria-label="Guide"
          >
            <span aria-hidden>❔</span>
            <span className="header-icon-label">Guide</span>
          </button>
          <button
            type="button"
            className="theme-toggle"
            onClick={() => window.location.reload()}
            title="Refresh — re-fetch all data"
            aria-label="Refresh"
          >
            ↻ Refresh
          </button>
          {session && (
            <button
              type="button"
              className="theme-toggle"
              onClick={handleLogout}
              title={`Signed in as ${session.email}`}
            >
              Sign out
            </button>
          )}
          <ThemeToggle />
        </div>
      </header>

      <div className="tabs">
        <button
          className={view === 'home' ? 'active' : ''}
          onClick={() => setView('home')}
        >
          Home
        </button>
        <button
          className={view === 'today' ? 'active' : ''}
          onClick={() => setView('today')}
        >
          Today
        </button>
        <button
          className={view === 'schedule' ? 'active' : ''}
          onClick={() => setView('schedule')}
        >
          Schedule
        </button>
        <button
          className={view === 'workouts' ? 'active' : ''}
          onClick={() => setView('workouts')}
        >
          Workouts
        </button>
        <button
          className={view === 'finance' ? 'active' : ''}
          onClick={() => setView('finance')}
        >
          Finance
        </button>
        <button
          className={view === 'log' ? 'active' : ''}
          onClick={() => setView('log')}
        >
          Log
        </button>
      </div>

      {error && (
        <div className="panel" style={{ borderColor: 'var(--bad)' }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {view === 'home' && <HomePanel onNavigate={(v) => setView(v as View)} />}
      {view === 'today' && (
        <DayPanel initialPlan={plan} onPlanChange={setPlan} />
      )}
      {view === 'schedule' && <SchedulePanel />}
      {view === 'workouts' && <WorkoutPanel />}
      {view === 'finance' && <FinancePanel />}
      {view === 'log' && <LogPanel />}
      {view === 'household' && <PersonaLauncher persona="household" />}
      {view === 'food' && <PersonaLauncher persona="grocery" />}
      {view === 'routines' && <RoutinesPage />}
      {view === 'guide' && <HowToGuide />}
    </div>
  );
}
