import { useEffect, useState } from 'react';
import { api } from '../api.js';
import type { Routine } from '@household-os/shared/types';

export default function RoutinesPage() {
  const [routines, setRoutines] = useState<Routine[] | null>(null);
  const [editing, setEditing] = useState<Routine | null>(null);
  const [scheduling, setScheduling] = useState<Routine | null>(null);

  useEffect(() => {
    void api.routines.list().then(setRoutines);
  }, []);

  function replaceRoutine(updated: Routine) {
    setRoutines((prev) =>
      prev?.map((r) => (r.key === updated.key ? updated : r)) ?? null,
    );
  }

  if (!routines) return <div className="muted">Loading…</div>;

  return (
    <div className="panel">
      <strong>Routines ({routines.length})</strong>
      {routines.map((r) => {
        const apptEnabled = r.appointment?.enabled === true;
        const linked = !!r.appointment?.calendar_event_id;
        const lastStart = r.appointment?.last_event_start;
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
              {r.scheduling.type} · {r.estimate_minutes}m · {r.energy}
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
          onSave={async (patch) => {
            const updated = await api.routines.patch(editing.key, patch);
            replaceRoutine(updated);
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
    </div>
  );
}

interface ModalProps {
  routine: Routine;
  onClose: () => void;
  onSave: (patch: Partial<Routine>) => Promise<void>;
}

function EditRoutineModal({ routine, onClose, onSave }: ModalProps) {
  const [estimate, setEstimate] = useState(routine.estimate_minutes);
  const [energy, setEnergy] = useState(routine.energy);
  const [active, setActive] = useState(routine.active);

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
        <label>
          Energy:{' '}
          <select
            value={energy}
            onChange={(e) => setEnergy(e.target.value as Routine['energy'])}
          >
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
          </select>
        </label>
        <br />
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
          <button
            onClick={() =>
              onSave({ estimate_minutes: estimate, energy, active })
            }
          >
            save
          </button>
        </div>
      </div>
    </div>
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

  // Default datetime-local value: tomorrow at 10:00 local. Native input
  // wants "YYYY-MM-DDTHH:mm" (no timezone suffix, no seconds).
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
      // Convert local "YYYY-MM-DDTHH:mm" to a real ISO string with TZ.
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
