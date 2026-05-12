import { useState } from 'react';
import TodayView from './components/TodayView.js';
import LookBackPanel from './components/LookBackPanel.js';
import StuffPanel from './components/StuffPanel.js';
import HowToGuide from './components/HowToGuide.js';
import ThemeToggle from './components/ThemeToggle.js';
import LoginScreen from './components/LoginScreen.js';
import {
  AUTH_ENABLED,
  clearSession,
  readSession,
  writeSession,
  type AuthSession,
} from './auth.js';

/**
 * §50 Phase C — compressed to three views.
 *
 *   today      → Phase B's TodayView (check-in + calendar + habits + Ask)
 *   look_back  → Phase C minimal LookBackPanel (Phase D fills in patterns)
 *   stuff      → Phase C StuffPanel with three sub-tabs (Routines, Finance, Assistant)
 *
 * Plus a single 'guide' header-icon route that opens the existing in-app
 * Guide tab (HowToGuide) — kept because it's the end-user reference per §30
 * of HANDOFF.
 *
 * Legacy view-ID migration: every pre-Phase-C value lands on 'today'.
 */
type View = 'today' | 'look_back' | 'stuff' | 'guide';

const VIEWS: readonly View[] = ['today', 'look_back', 'stuff', 'guide'] as const;

const VIEW_KEY = 'household-os.view';

function readSavedView(): View {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    if (!v) return 'today';
    if ((VIEWS as readonly string[]).includes(v)) return v as View;
    // Phase C migration: any legacy view key (home, today, schedule, workouts,
    // finance, log, activity, journal, household, food, routines) falls
    // through to today. Finance / routines / assistant land in Stuff but a
    // hard fallback to today is the safe move per §50.
  } catch {
    /* localStorage unavailable */
  }
  return 'today';
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
  const [session, setSession] = useState<AuthSession | null>(() =>
    AUTH_ENABLED ? readSession() : null,
  );

  function handleLogin(s: AuthSession) {
    writeSession(s);
    setSession(s);
  }

  function handleLogout() {
    clearSession();
    setSession(null);
  }

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
          className={view === 'today' ? 'active' : ''}
          onClick={() => setView('today')}
        >
          Today
        </button>
        <button
          className={view === 'look_back' ? 'active' : ''}
          onClick={() => setView('look_back')}
        >
          Look Back
        </button>
        <button
          className={view === 'stuff' ? 'active' : ''}
          onClick={() => setView('stuff')}
        >
          Stuff
        </button>
      </div>

      {view === 'today' && <TodayView />}
      {view === 'look_back' && <LookBackPanel />}
      {view === 'stuff' && <StuffPanel />}
      {view === 'guide' && <HowToGuide />}
    </div>
  );
}
