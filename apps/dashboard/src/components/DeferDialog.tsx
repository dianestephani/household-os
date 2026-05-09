import { useState } from 'react';
import type { DeferReasonCode } from '@household-os/shared/types';

const REASONS: { value: DeferReasonCode; label: string }[] = [
  { value: 'tired', label: "I'm tired" },
  { value: 'not_in_mood', label: 'Not in the mood' },
  { value: 'out_of_time', label: 'Out of time' },
  { value: 'other', label: 'Other / skip' },
];

interface Props {
  itemName: string;
  onConfirm: (reason: DeferReasonCode, notes: string) => void;
  onCancel: () => void;
}

export default function DeferDialog({ itemName, onConfirm, onCancel }: Props) {
  const [reason, setReason] = useState<DeferReasonCode>('tired');
  const [notes, setNotes] = useState('');

  return (
    <div className="suggestion-modal" onClick={onCancel}>
      <div className="box" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>Defer "{itemName}"</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          Optional — helps spot patterns later.
        </p>
        {REASONS.map((r) => (
          <label key={r.value} style={{ display: 'block', margin: '0.25rem 0' }}>
            <input
              type="radio"
              name="reason"
              checked={reason === r.value}
              onChange={() => setReason(r.value)}
            />{' '}
            {r.label}
          </label>
        ))}
        <textarea
          placeholder="Notes (optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          style={{
            width: '100%',
            marginTop: '0.5rem',
            padding: '0.4rem',
            font: 'inherit',
            border: '1px solid var(--border)',
            borderRadius: '4px',
          }}
        />
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
          <button className="icon-btn" onClick={onCancel}>cancel</button>
          <button onClick={() => onConfirm(reason, notes)}>defer</button>
        </div>
      </div>
    </div>
  );
}
