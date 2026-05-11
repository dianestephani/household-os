import { useEffect, useState } from 'react';
import ActivityFeed from './ActivityFeed.js';
import JournalPanel from './JournalPanel.js';

type Mode = 'activity' | 'journal';

const STORAGE_KEY = 'household-os.log-mode';

function readMode(): Mode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'activity' || v === 'journal') return v;
  } catch {
    /* localStorage unavailable */
  }
  return 'activity';
}

/**
 * Phase 3 §47 — merged Log tab. Replaces the standalone Activity + Journal
 * tabs with a single tab that toggles between them. Each sub-panel keeps its
 * existing internal date controls (range / single-day) — this wrapper only
 * decides which one is on screen and persists the choice.
 */
export default function LogPanel() {
  const [mode, setModeRaw] = useState<Mode>(readMode);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      /* localStorage unavailable */
    }
  }, [mode]);

  return (
    <>
      <div
        className="pill-toggle"
        role="tablist"
        aria-label="Log view"
        style={{ marginBottom: '1rem' }}
      >
        <button
          className={mode === 'activity' ? 'active' : ''}
          onClick={() => setModeRaw('activity')}
          role="tab"
          aria-selected={mode === 'activity'}
          type="button"
        >
          Activity
        </button>
        <button
          className={mode === 'journal' ? 'active' : ''}
          onClick={() => setModeRaw('journal')}
          role="tab"
          aria-selected={mode === 'journal'}
          type="button"
        >
          Journal
        </button>
      </div>
      {mode === 'activity' ? <ActivityFeed /> : <JournalPanel />}
    </>
  );
}
