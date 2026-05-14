import { useEffect, useState } from 'react';
import { api } from '../api.js';
import type { Routine } from '@household-os/shared/types';

/**
 * §50 Phase E — Stuff/Routines table. Edit modal now lets her change the
 * cadence (interval_days) directly; on Save, if the routine is appointment-
 * enabled AND interval_days actually changed, a cadence-shift modal asks
 * which strategy to apply ('one_off' | 'shift_all' | 'skip_one'). For
 * non-appointment routines or pure name/estimate edits, no modal — Save
 * just patches and returns.
 *
 * Dropped from the previous Phase 4 edit modal: the `energy` dropdown
 * (`energy` retired in Phase E's Routine simplification). Added: an
 * interval_days input that's only meaningful for `scheduling.type ===
 * 'rolling'`.
 */

type CadenceStrategy = 'one_off' | 'shift_all' | 'skip_one';

interface PendingPatch {
  routine: Routine;
  patch: Partial<Routine>;
  /** True when interval_days changed on an appointment-enabled rolling routine. */
  needsStrategy: boolean;
}

export default function RoutinesPage() {
  const [routines, setRoutines] = useState<Routine[] | null>(null);
  const [editing, setEditing] = useState<Routine | null>(null);
  const [scheduling, setScheduling] = useState<Routine | null>(null);
  const [pendingStrategy, setPendingStrategy] = useState<PendingPatch | null>(null);

  useEffect(() => {
    void api.routines.list().then(setRoutines);
  }, []);

  function replaceRoutine(updated: Routine) {
    setRoutines((prev) =>
      prev?.map((r) => (r.key === updated.key ? updated : r)) ?? null,
    );
  }

  async function applyPatch(
    routine: Routine,
    patch: Partial<Routine>,
    strategy?: CadenceStrategy,
  ) {
    const updated = await api.routines.patch(
      routine.key,
      patch,
      strategy ? { cadence_shift_strategy: strategy } : {},
    );
    replaceRoutine(updated);
  }

  if (!routines) return <div className="muted">Loading…</div>;

  return (
    <div className="panel">
      <strong>Routines ({routines.length})</strong>
      {routines.map((r) => {
        const apptEnabled = r.appointment?.enabled === true;
        const linked = !!r.appointment?.calendar_event_id;
        const lastStart = r.appointment?.last_event_start;
        const interval =
          r.scheduling.type === 'rolling'
            ? `${r.scheduling.interval_days}d`
            : r.scheduling.type === 'fixed'
              ? r.scheduling.biweekly
                ? `${r.scheduling.day_of_week} biweekly`
                : (r.scheduling.day_of_week ?? 'fixed')
              : r.scheduling.type;
        return (
          <div key={r.key} className="row">
            <span className="name">
              {r.name}
              {apptEnabled && linked && lastStart && (
                <span
                  className="muted"
                  style={{ marginLeft: '0.4rem', fontSize: '0.78rem' }}
                  title={`Linked to a Google Calendar event starting ${new Date(lastStart as string).toLocaleString()}`}
                >
                  📅 {new Date(lastStart as string).toLocaleDateString(
                    undefined,
                    { month: 'short', day: 'numeric' },
                  )}
                </span>
              )}
            </span>
            <span className="meta">
              {interval} · {r.estimate_minutes}m
            </span>
            {apptEnabled && (
              <button
                className="icon-btn"
                onClick={() => setScheduling(r)}
                title={
                  linked
                    ? 'Reschedule or unlink this appointment'
                    : 'Schedule a calendar appointment for this routine'
                }
              >
                {linked ? '📅 linked' : '📅 schedule'}
              </button>
            )}
            <button className="icon-btn" onClick={() => setEditing(r)}>
              edit
            </button>
          </div>
        );
      })}

      {editing && (
        <EditRoutineModal
          routine={editing}
          onClose={() => setEditing(null)}
          onSave={async (patch, intervalChanged) => {
            const apptEnabled = editing.appointment?.enabled === true;
            // Only prompt for a cadence-shift strategy when:
            //  (a) interval_days actually changed, AND
            //  (b) the routine is appointment-enabled (otherwise strategy is
            //      meaningless — there's no Calendar event to skip).
            if (intervalChanged && apptEnabled) {
              setPendingStrategy({
                routine: editing,
                patch,
                needsStrategy: true,
              });
              setEditing(null);
              return;
            }
            await applyPatch(editing, patch);
            setEditing(null);
          }}
        />
      )}

      {scheduling && (
        <ScheduleAppointmentModal
          routine={scheduling}
          onClose={() => setScheduling(null)}
          onSaved={(updated) => {
            replaceRoutine(updated);
            setScheduling(null);
          }}
        />
      )}

      {pendingStrategy && (
        <CadenceShiftModal
          routine={pendingStrategy.routine}
          onClose={() => setPendingStrategy(null)}
          onChoose={async (strategy) => {
            await applyPatch(
              pendingStrategy.routine,
              pendingStrategy.patch,
              strategy,
            );
            setPendingStrategy(null);
          }}
        />
      )}
    </div>
  );
}

interface EditModalProps {
  routine: Routine;
  onClose: () => void;
  onSave: (patch: Partial<Routine>, intervalChanged: boolean) => Promise<void>;
}

function EditRoutineModal({ routine, onClose, onSave }: EditModalProps) {
  const [estimate, setEstimate] = useState(routine.estimate_minutes);
  const [intervalDays, setIntervalDays] = useState<number>(
    routine.scheduling.interval_days ?? 0,
  );
  const [active, setActive] = useState(routine.active);
  const isRolling = routine.scheduling.type === 'rolling';

  const intervalChanged =
    isRolling && intervalDays !== (routine.scheduling.interval_days ?? 0);

  function handleSave() {
    const patch: Partial<Routine> = {
      estimate_minutes: estimate,
      active,
    };
    if (intervalChanged) {
      patch.scheduling = {
        ...routine.scheduling,
        interval_days: intervalDays,
      };
    }
    void onSave(patch, intervalChanged);
  }

  return (
    <div className="suggestion-modal" onClick={onClose}>
      <div className="box" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>{routine.name}</h3>
        <label>
          Estimate (min):{' '}
          <input
            type="number"
            value={estimate}
            onChange={(e) => setEstimate(Number(e.target.value))}
          />
        </label>
        <br />
        {isRolling && (
          <>
            <label>
              Interval (days):{' '}
              <input
                type="number"
                min={1}
                value={intervalDays}
                onChange={(e) => setIntervalDays(Number(e.target.value))}
              />
            </label>
            <br />
          </>
        )}
        <label>
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
          />
          {' '}active
        </label>
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
          <button className="icon-btn" onClick={onClose}>cancel</button>
          <button onClick={handleSave}>save</button>
        </div>
      </div>
    </div>
  );
}

interface CadenceModalProps {
  routine: Routine;
  onClose: () => void;
  onChoose: (strategy: CadenceStrategy) => Promise<void>;
}

function CadenceShiftModal({ routine, onClose, onChoose }: CadenceModalProps) {
  const [busy, setBusy] = useState(false);
  const linked = !!routine.appointment?.calendar_event_id;

  async function choose(strategy: CadenceStrategy) {
    setBusy(true);
    try {
      await onChoose(strategy);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="suggestion-modal" onClick={onClose}>
      <div className="box" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>How should this apply?</h3>
        <p className="muted" style={{ fontSize: '0.88rem', marginBottom: '0.8rem' }}>
          You changed the cadence on <strong>{routine.name}</strong>
          {linked ? ', which has an upcoming Calendar event.' : '.'} Pick the
          strategy that matches what you meant.
        </p>
        <div
          style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}
        >
          <StrategyButton
            label="Shift all going forward"
            description="The new cadence applies from now on. Upcoming Calendar event stays where it is — reconcile picks it up if you move it manually."
            onClick={() => choose('shift_all')}
            disabled={busy}
          />
          <StrategyButton
            label="Skip the next one"
            description={
              linked
                ? "Clears the upcoming Calendar event link; cadence (interval_days) keeps its prior value."
                : 'Cadence keeps its prior value; this routine just gets one skip recorded.'
            }
            onClick={() => choose('skip_one')}
            disabled={busy}
          />
          <StrategyButton
            label="Just this once"
            description="One-time tweak. No side effects beyond the patch — useful when you're correcting a wrong number, not changing the cadence."
            onClick={() => choose('one_off')}
            disabled={busy}
          />
        </div>
        <div style={{ marginTop: '0.8rem' }}>
          <button className="icon-btn" onClick={onClose} disabled={busy}>
            cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function StrategyButton({
  label,
  description,
  onClick,
  disabled,
}: {
  label: string;
  description: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        textAlign: 'left',
        padding: '0.6rem 0.8rem',
        border: '1px solid var(--border)',
        borderRadius: '6px',
        background: 'var(--bg)',
        color: 'var(--text)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        fontFamily: 'inherit',
        fontSize: '0.92rem',
      }}
    >
      <div style={{ fontWeight: 600 }}>{label}</div>
      <div className="muted" style={{ fontSize: '0.82rem', marginTop: '0.2rem' }}>
        {description}
      </div>
    </button>
  );
}

interface ScheduleModalProps {
  routine: Routine;
  onClose: () => void;
  onSaved: (updated: Routine) => void;
}

function ScheduleAppointmentModal({
  routine,
  onClose,
  onSaved,
}: ScheduleModalProps) {
  const defaultDuration =
    routine.appointment?.default_duration_minutes ?? 60;
  const linkedStart = routine.appointment?.last_event_start;
  const linkedEventId = routine.appointment?.calendar_event_id;

  const tomorrowAt10 = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(10, 0, 0, 0);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  })();

  const [startsAt, setStartsAt] = useState(tomorrowAt10);
  const [duration, setDuration] = useState(defaultDuration);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const local = new Date(startsAt);
      if (Number.isNaN(local.getTime())) {
        throw new Error('Invalid date/time');
      }
      const result = await api.appointments.create(
        routine.key,
        local.toISOString(),
        duration,
      );
      onSaved(result.routine);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function unlink() {
    setSaving(true);
    setError(null);
    try {
      const updated = await api.appointments.unlink(routine.key);
      onSaved(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unlink failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="suggestion-modal" onClick={onClose}>
      <div className="box" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>📅 Schedule "{routine.name}"</h3>
        {linkedEventId && linkedStart && (
          <p
            className="muted"
            style={{ fontSize: '0.85rem', marginBottom: '0.8rem' }}
          >
            Currently linked to a Google Calendar event on{' '}
            <strong>
              {new Date(linkedStart as string).toLocaleString()}
            </strong>
            . Submitting below creates a new event; use "Unlink" to detach
            without deleting.
          </p>
        )}
        <label style={{ display: 'block', marginBottom: '0.6rem' }}>
          When:{' '}
          <input
            type="datetime-local"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
          />
        </label>
        <label style={{ display: 'block', marginBottom: '0.6rem' }}>
          Duration (min):{' '}
          <input
            type="number"
            min={5}
            max={480}
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
          />
        </label>
        <p
          className="muted"
          style={{ fontSize: '0.78rem', marginBottom: '0.6rem' }}
        >
          Creates a real event on your Google Calendar. The system will pick
          up reschedules/deletes you make in Google within the hour.
        </p>
        {error && (
          <div
            style={{
              color: 'var(--bad)',
              fontSize: '0.85rem',
              marginBottom: '0.4rem',
            }}
          >
            {error}
          </div>
        )}
        <div
          style={{
            display: 'flex',
            gap: '0.5rem',
            marginTop: '0.8rem',
            flexWrap: 'wrap',
          }}
        >
          <button className="icon-btn" onClick={onClose} disabled={saving}>
            cancel
          </button>
          {linkedEventId && (
            <button
              className="icon-btn"
              onClick={unlink}
              disabled={saving}
              title="Detach this routine from its Google Calendar event"
            >
              unlink
            </button>
          )}
          <button onClick={save} disabled={saving}>
            {saving ? 'Saving…' : linkedEventId ? 'Reschedule' : 'Schedule'}
          </button>
        </div>
      </div>
    </div>
  );
}
