import { useEffect, useState } from 'react';
import { api } from './api.js';
import TodayList from './components/TodayList.js';
import EnergyButtons from './components/EnergyButtons.js';
import MoodButtons from './components/MoodButtons.js';
import WorkoutPanel from './components/WorkoutPanel.js';
import CheckInBanner from './components/CheckInBanner.js';
import ActivityFeed from './components/ActivityFeed.js';
import PersonaLauncher from './components/PersonaLauncher.js';
import RoutinesPage from './components/RoutinesPage.js';
import HowToGuide from './components/HowToGuide.js';
import FinancePanel from './components/FinancePanel.js';
import JournalPanel from './components/JournalPanel.js';
import TodayContextStrip from './components/TodayContextStrip.js';
import CalendarDayPanel from './components/CalendarDayPanel.js';
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

type View =
  | 'today'
  | 'schedule'
  | 'workouts'
  | 'activity'
  | 'household'
  | 'nutrition'
  | 'finance'
  | 'routines'
  | 'journal'
  | 'guide';

export default function App() {
  const [view, setView] = useState<View>('today');
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
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
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
        <button className={view === 'today' ? 'active' : ''} onClick={() => setView('today')}>
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
          className={view === 'activity' ? 'active' : ''}
          onClick={() => setView('activity')}
        >
          Activity
        </button>
        <button
          className={view === 'household' ? 'active' : ''}
          onClick={() => setView('household')}
        >
          Household Ops
        </button>
        <button
          className={view === 'nutrition' ? 'active' : ''}
          onClick={() => setView('nutrition')}
        >
          Nutrition
        </button>
        <button
          className={view === 'finance' ? 'active' : ''}
          onClick={() => setView('finance')}
        >
          Finance
        </button>
        <button
          className={view === 'routines' ? 'active' : ''}
          onClick={() => setView('routines')}
        >
          Routines
        </button>
        <button
          className={view === 'journal' ? 'active' : ''}
          onClick={() => setView('journal')}
        >
          Journal
        </button>
        <button
          className={view === 'guide' ? 'active' : ''}
          onClick={() => setView('guide')}
          title="How-to guide for everything Household OS can do"
          style={{ marginLeft: 'auto' }}
        >
          ❔ Guide
        </button>
      </div>

      {error && (
        <div className="panel" style={{ borderColor: 'var(--bad)' }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {view === 'today' && plan && (
        <>
          <CheckInBanner />
          <CalendarDayPanel />
          <TodayContextStrip />
          <EnergyButtons current={plan.current_energy} onChange={setPlan} />
          <MoodButtons />
          <TodayList plan={plan} onChange={setPlan} />
        </>
      )}
      {view === 'today' && !plan && !error && <div className="muted">Loading…</div>}

      {view === 'schedule' && <SchedulePanel />}
      {view === 'workouts' && <WorkoutPanel />}
      {view === 'activity' && <ActivityFeed />}

      {view === 'household' && <PersonaLauncher persona="household" />}
      {view === 'nutrition' && (
        <div className="panel">
          <strong>Nutrition</strong>
          <p className="muted" style={{ marginTop: '0.4rem' }}>
            Nutrition persona isn't built yet — Diane is starting with Household Ops.
          </p>
        </div>
      )}
      {view === 'finance' && <FinancePanel />}
      {view === 'routines' && <RoutinesPage />}
      {view === 'journal' && <JournalPanel />}
      {view === 'guide' && <HowToGuide />}
    </div>
  );
}
