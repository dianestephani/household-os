import { useEffect, useState } from 'react';
import { api } from './api.js';
import TodayList from './components/TodayList.js';
import EnergyButtons from './components/EnergyButtons.js';
import MoodButtons from './components/MoodButtons.js';
import WorkoutPanel from './components/WorkoutPanel.js';
import CheckInBanner from './components/CheckInBanner.js';
import ActivityFeed from './components/ActivityFeed.js';
import ChatPanel from './components/ChatPanel.js';
import RoutinesPage from './components/RoutinesPage.js';
import HowToGuide from './components/HowToGuide.js';
import type { TodayPlan } from '@household-os/shared/types';

type View =
  | 'today'
  | 'workouts'
  | 'activity'
  | 'household'
  | 'nutrition'
  | 'finance'
  | 'routines'
  | 'guide';

export default function App() {
  const [view, setView] = useState<View>('today');
  const [plan, setPlan] = useState<TodayPlan | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      setPlan(await api.today.get());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <div className="app">
      <h1>Household OS</h1>

      <div className="tabs">
        <button className={view === 'today' ? 'active' : ''} onClick={() => setView('today')}>
          Today
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
          <EnergyButtons current={plan.current_energy} onChange={setPlan} />
          <MoodButtons />
          <TodayList plan={plan} onChange={setPlan} />
        </>
      )}
      {view === 'today' && !plan && !error && <div className="muted">Loading…</div>}

      {view === 'workouts' && <WorkoutPanel />}
      {view === 'activity' && <ActivityFeed />}

      {view === 'household' && <ChatPanel persona="household" onUpdate={refresh} />}
      {view === 'nutrition' && <ChatPanel persona="nutrition" stub />}
      {view === 'finance' && <ChatPanel persona="finance" stub />}
      {view === 'routines' && <RoutinesPage />}
      {view === 'guide' && <HowToGuide />}
    </div>
  );
}
