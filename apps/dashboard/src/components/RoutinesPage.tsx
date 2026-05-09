import { useEffect, useState } from 'react';
import { api } from '../api.js';
import type { Routine } from '@household-os/shared/types';

export default function RoutinesPage() {
  const [routines, setRoutines] = useState<Routine[] | null>(null);
  const [editing, setEditing] = useState<Routine | null>(null);

  useEffect(() => {
    void api.routines.list().then(setRoutines);
  }, []);

  if (!routines) return <div className="muted">Loading…</div>;

  return (
    <div className="panel">
      <strong>Routines ({routines.length})</strong>
      {routines.map((r) => (
        <div key={r.key} className="row">
          <span className="name">{r.name}</span>
          <span className="meta">
            {r.scheduling.type} · {r.estimate_minutes}m · {r.energy}
          </span>
          <button className="icon-btn" onClick={() => setEditing(r)}>
            edit
          </button>
        </div>
      ))}

      {editing && (
        <EditRoutineModal
          routine={editing}
          onClose={() => setEditing(null)}
          onSave={async (patch) => {
            const updated = await api.routines.patch(editing.key, patch);
            setRoutines((prev) =>
              prev?.map((r) => (r.key === updated.key ? updated : r)) ?? null,
            );
            setEditing(null);
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
