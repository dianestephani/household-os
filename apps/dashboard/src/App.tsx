import { useEffect, useState } from 'react';
import { api } from './api.js';
import TodayList from './components/TodayList.js';
import EnergyButtons from './components/EnergyButtons.js';
import ChatPanel from './components/ChatPanel.js';
import RoutinesPage from './components/RoutinesPage.js';
import type { TodayPlan } from '@household-os/shared/types';

type View = 'today' | 'household' | 'nutrition' | 'finance' | 'routines';

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
      </div>

      {error && (
        <div className="panel" style={{ borderColor: 'var(--bad)' }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {view === 'today' && plan && (
        <>
          <EnergyButtons current={plan.current_energy} onChange={setPlan} />
          <TodayList plan={plan} onChange={setPlan} />
        </>
      )}
      {view === 'today' && !plan && !error && <div className="muted">Loading…</div>}

      {view === 'household' && <ChatPanel persona="household" onUpdate={refresh} />}
      {view === 'nutrition' && <ChatPanel persona="nutrition" stub />}
      {view === 'finance' && <ChatPanel persona="finance" stub />}
      {view === 'routines' && <RoutinesPage />}
    </div>
  );
}
