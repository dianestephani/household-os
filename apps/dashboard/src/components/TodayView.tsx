import MorningCheckinForm from './MorningCheckinForm.js';
import CalendarDayPanel from './CalendarDayPanel.js';
import HabitsReminder from './HabitsReminder.js';
import AskPanel from './AskPanel.js';

/**
 * §50 Phase B — the new Today view. Single-column stack of:
 *   1. MorningCheckinForm  — three pulses + optional note
 *   2. CalendarDayPanel    — Google Calendar events for today (reused from §47 Phase 3)
 *   3. HabitsReminder      — static visual cue, no DB
 *   4. AskPanel            — chat with the unified assistant
 *
 * Replaces the §47 Phase 3 widget-grid Home as the default landing per §50.
 * The old HomePanel/DayPanel/etc. stay reachable on their existing tabs
 * through the Phase C tab-compression — nothing is "down for the rebuild."
 */

export default function TodayView() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <MorningCheckinForm />
      <CalendarDayPanel />
      <HabitsReminder />
      <AskPanel />
    </div>
  );
}
