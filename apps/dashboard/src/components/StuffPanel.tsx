import { useEffect, useState } from 'react';
import RoutinesPage from './RoutinesPage.js';
import FinancePanel from './FinancePanel.js';
import AssistantSettingsPanel from './AssistantSettingsPanel.js';

/**
 * §50 Phase C — Stuff view. Three sub-tabs: Routines, Finance, Assistant
 * Settings. Each wraps an existing surface (FinancePanel + RoutinesPage
 * survived from §47; AssistantSettingsPanel is new in Phase C).
 *
 * Sub-tab persistence: `localStorage.household-os.stuff-tab` so a Stuff
 * navigation round-trip remembers where Diane was.
 */

type SubTab = 'routines' | 'finance' | 'assistant';

const SUB_TABS: { key: SubTab; label: string }[] = [
  { key: 'routines', label: 'Routines' },
  { key: 'finance', label: 'Finance' },
  { key: 'assistant', label: 'Assistant settings' },
];

const STORAGE_KEY = 'household-os.stuff-tab';

function readSavedTab(): SubTab {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'routines' || v === 'finance' || v === 'assistant') return v;
  } catch {
    /* localStorage unavailable */
  }
  return 'routines';
}

export default function StuffPanel() {
  const [tab, setTab] = useState<SubTab>(readSavedTab);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, tab);
    } catch {
      /* localStorage unavailable */
    }
  }, [tab]);

  return (
    <div>
      <div className="tabs" style={{ marginBottom: '1rem' }}>
        {SUB_TABS.map((t) => (
          <button
            key={t.key}
            className={tab === t.key ? 'active' : ''}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'routines' && <RoutinesPage />}
      {tab === 'finance' && <FinancePanel />}
      {tab === 'assistant' && <AssistantSettingsPanel />}
    </div>
  );
}
