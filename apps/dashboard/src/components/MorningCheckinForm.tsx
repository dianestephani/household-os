import { useEffect, useState } from 'react';
import { api } from '../api.js';
import type {
  AwakenessLevel,
  EnergyLevel,
  MoodLevel,
  MorningCheckin,
} from '@household-os/shared/types';

/**
 * §50 Phase B — single-document morning check-in. Three button-row pickers
 * + optional one-line note. Once today's check-in exists, the form collapses
 * to a summary line with an Edit toggle. No streaks, no scoring — this is
 * Diane's introspection surface, not a habit tracker.
 */

const MOODS: { value: MoodLevel; label: string }[] = [
  { value: 'down', label: 'Down' },
  { value: 'neutral', label: 'Neutral' },
  { value: 'good', label: 'Good' },
];
const ENERGIES: { value: EnergyLevel; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];
const AWAKE: { value: AwakenessLevel; label: string }[] = [
  { value: 'groggy', label: 'Groggy' },
  { value: 'meh', label: 'Meh' },
  { value: 'alert', label: 'Alert' },
];

const TIME_FMT = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
});

interface Props {
  /** Called after a successful save so parents can refresh dependent state. */
  onSaved?: (checkin: MorningCheckin) => void;
}

export default function MorningCheckinForm({ onSaved }: Props) {
  const [existing, setExisting] = useState<MorningCheckin | null>(null);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [mood, setMood] = useState<MoodLevel | null>(null);
  const [energy, setEnergy] = useState<EnergyLevel | null>(null);
  const [awakeness, setAwakeness] = useState<AwakenessLevel | null>(null);
  const [note, setNote] = useState('');

  useEffect(() => {
    void (async () => {
      try {
        const today = await api.morningCheckin.get();
        setExisting(today);
        if (today) {
          setMood(today.mood);
          setEnergy(today.energy);
          setAwakeness(today.awakeness);
          setNote(today.note ?? '');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const ready = mood !== null && energy !== null && awakeness !== null;

  async function handleSave() {
    if (!ready || mood === null || energy === null || awakeness === null) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await api.morningCheckin.save({
        mood,
        energy,
        awakeness,
        note: note.trim() || undefined,
      });
      setExisting(saved);
      setEditing(false);
      onSaved?.(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="panel">
        <strong>Morning check-in</strong>
        <div className="muted" style={{ marginTop: '0.4rem' }}>Loading…</div>
      </div>
    );
  }

  // Collapsed summary — today's already logged, not currently editing.
  if (existing && !editing) {
    const ts = new Date(
      (existing.updated_at ?? existing.created_at ?? new Date()) as string,
    );
    const moodLabel = MOODS.find((m) => m.value === existing.mood)?.label ?? existing.mood;
    const energyLabel = ENERGIES.find((e) => e.value === existing.energy)?.label ?? existing.energy;
    const awakeLabel = AWAKE.find((a) => a.value === existing.awakeness)?.label ?? existing.awakeness;
    return (
      <div className="panel">
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: '0.5rem',
            flexWrap: 'wrap',
          }}
        >
          <div>
            <span style={{ color: 'var(--good)', marginRight: '0.4rem' }}>✓</span>
            <strong>Morning check-in</strong>{' '}
            <span className="muted" style={{ fontSize: '0.85rem' }}>
              at {TIME_FMT.format(ts)}
            </span>
          </div>
          <button
            type="button"
            className="muted"
            onClick={() => setEditing(true)}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              fontSize: '0.85rem',
              padding: 0,
              textDecoration: 'underline',
            }}
          >
            Edit
          </button>
        </div>
        <div style={{ marginTop: '0.5rem', fontSize: '0.95rem' }}>
          {moodLabel} · {energyLabel} energy · {awakeLabel}
        </div>
        {existing.note && (
          <div
            className="muted"
            style={{ marginTop: '0.4rem', fontSize: '0.88rem' }}
          >
            {existing.note}
          </div>
        )}
      </div>
    );
  }

  // Form: either no check-in yet OR the user clicked Edit.
  return (
    <div className="panel">
      <strong>Morning check-in</strong>
      <div className="muted" style={{ marginTop: '0.25rem', fontSize: '0.85rem' }}>
        Three quick pulses + an optional line of context. Pure introspection — no
        streaks.
      </div>

      <PickerRow
        label="Mood"
        options={MOODS}
        value={mood}
        onChange={setMood}
        disabled={saving}
      />
      <PickerRow
        label="Energy"
        options={ENERGIES}
        value={energy}
        onChange={setEnergy}
        disabled={saving}
      />
      <PickerRow
        label="Awakeness"
        options={AWAKE}
        value={awakeness}
        onChange={setAwakeness}
        disabled={saving}
      />

      <label
        style={{
          display: 'block',
          marginTop: '0.75rem',
          fontSize: '0.9rem',
        }}
      >
        Note (optional)
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value.slice(0, 500))}
          rows={2}
          placeholder="anything worth remembering about this morning"
          disabled={saving}
          style={{
            display: 'block',
            width: '100%',
            marginTop: '0.3rem',
            padding: '0.45rem 0.55rem',
            border: '1px solid var(--border)',
            borderRadius: '6px',
            background: 'var(--bg)',
            color: 'var(--text)',
            fontFamily: 'inherit',
            fontSize: '0.92rem',
            resize: 'vertical',
            boxSizing: 'border-box',
          }}
        />
      </label>

      {error && (
        <div className="muted" style={{ marginTop: '0.5rem', color: 'var(--bad)' }}>
          {error}
        </div>
      )}

      <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem' }}>
        <button
          type="button"
          onClick={handleSave}
          disabled={!ready || saving}
          className="theme-toggle"
          style={{ opacity: !ready || saving ? 0.5 : 1 }}
        >
          {saving ? 'Saving…' : existing ? 'Save changes' : 'Save check-in'}
        </button>
        {existing && (
          <button
            type="button"
            className="theme-toggle"
            onClick={() => {
              setEditing(false);
              setMood(existing.mood);
              setEnergy(existing.energy);
              setAwakeness(existing.awakeness);
              setNote(existing.note ?? '');
              setError(null);
            }}
            disabled={saving}
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

interface PickerRowProps<V extends string> {
  label: string;
  options: { value: V; label: string }[];
  value: V | null;
  onChange: (v: V) => void;
  disabled?: boolean;
}

function PickerRow<V extends string>({
  label,
  options,
  value,
  onChange,
  disabled,
}: PickerRowProps<V>) {
  return (
    <div style={{ marginTop: '0.75rem' }}>
      <div className="muted" style={{ fontSize: '0.82rem', marginBottom: '0.3rem' }}>
        {label}
      </div>
      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            disabled={disabled}
            className="theme-toggle"
            style={{
              opacity: disabled ? 0.5 : 1,
              borderColor: value === o.value ? 'var(--text)' : 'var(--border)',
              fontWeight: value === o.value ? 600 : 400,
            }}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
