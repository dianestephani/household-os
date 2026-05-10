import { useEffect, useState } from 'react';
import { api } from '../api.js';
import DayNavigator, { formatHeader, localToday } from './DayNavigator.js';
import type {
  ContextEntry,
  ContextRelatedPersona,
  EnergyLevel,
  MoodLevel,
} from '@household-os/shared/types';

const COMMON_BLOCKED = [
  'workout',
  'errands',
  'leave_house',
  'meal_prep',
  'cleaning',
  'sleep',
];

type Mode = 'range' | 'day';

export default function JournalPanel() {
  const [entries, setEntries] = useState<ContextEntry[]>([]);
  const [mode, setMode] = useState<Mode>('range');
  const [days, setDays] = useState(14);
  const [date, setDate] = useState(localToday());
  const [text, setText] = useState('');
  const [showStructured, setShowStructured] = useState(false);
  const [tagsInput, setTagsInput] = useState('');
  const [energy, setEnergy] = useState<EnergyLevel | ''>('');
  const [mood, setMood] = useState<MoodLevel | ''>('');
  const [dogsitCount, setDogsitCount] = useState<number | ''>('');
  const [blockedSet, setBlockedSet] = useState<Set<string>>(new Set());
  const [persona, setPersona] = useState<ContextRelatedPersona>('both');
  const [busy, setBusy] = useState(false);

  async function refresh() {
    if (mode === 'day') {
      setEntries(await api.context.onDate(date));
    } else {
      setEntries(await api.context.list(days));
    }
  }

  useEffect(() => {
    void refresh();
  }, [mode, days, date]);

  function toggleBlocked(name: string) {
    const next = new Set(blockedSet);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setBlockedSet(next);
  }

  async function save() {
    if (!text.trim()) return;
    setBusy(true);
    try {
      const tags = tagsInput
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      await api.context.add({
        text: text.trim(),
        tags: tags.length > 0 ? tags : undefined,
        energy: energy || undefined,
        mood: mood || undefined,
        dogsit_count:
          typeof dogsitCount === 'number' ? dogsitCount : undefined,
        blocked_activities:
          blockedSet.size > 0 ? Array.from(blockedSet) : undefined,
        related_persona: persona,
      });
      setText('');
      setTagsInput('');
      setEnergy('');
      setMood('');
      setDogsitCount('');
      setBlockedSet(new Set());
      setPersona('both');
      setShowStructured(false);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="panel">
        <strong>New entry</strong>
        <p className="muted" style={{ marginTop: '0.25rem' }}>
          Drop qualitative context here — load (number of dogs, weather), why you're tired,
          things that didn't happen and why, anything that should affect how either persona
          reasons later. Free text is enough; structured fields make it patterns-queryable.
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          placeholder="e.g. 5 dogs today, constant cleanup. Too tired to work out, didn't leave the house."
          style={{
            width: '100%',
            padding: '0.5rem',
            font: 'inherit',
            border: '1px solid var(--border)',
            borderRadius: '4px',
          }}
        />
        <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button onClick={save} disabled={busy || !text.trim()}>
            {busy ? 'Saving…' : 'Log entry'}
          </button>
          <button
            type="button"
            onClick={() => setShowStructured((s) => !s)}
            className="muted"
            style={{ background: 'transparent', border: '1px solid var(--border)' }}
          >
            {showStructured ? 'Hide' : 'Add'} structured fields
          </button>
          <label className="muted" style={{ marginLeft: 'auto' }}>
            Relevant to:{' '}
            <select
              value={persona}
              onChange={(e) => setPersona(e.target.value as ContextRelatedPersona)}
              style={{ padding: '0.25rem' }}
            >
              <option value="both">Both</option>
              <option value="household">Household</option>
              <option value="finance">Finance</option>
            </select>
          </label>
        </div>

        {showStructured && (
          <div
            style={{
              marginTop: '0.75rem',
              padding: '0.75rem',
              border: '1px solid var(--border)',
              borderRadius: '4px',
              display: 'grid',
              gap: '0.5rem',
            }}
          >
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem' }}>
              <label>
                Energy{' '}
                <select
                  value={energy}
                  onChange={(e) => setEnergy(e.target.value as EnergyLevel | '')}
                  style={{ width: '100%', padding: '0.3rem' }}
                >
                  <option value="">—</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </label>
              <label>
                Mood{' '}
                <select
                  value={mood}
                  onChange={(e) => setMood(e.target.value as MoodLevel | '')}
                  style={{ width: '100%', padding: '0.3rem' }}
                >
                  <option value="">—</option>
                  <option value="good">Good</option>
                  <option value="neutral">Neutral</option>
                  <option value="down">Down</option>
                </select>
              </label>
              <label>
                Dogsit count{' '}
                <input
                  type="number"
                  min="0"
                  value={dogsitCount}
                  onChange={(e) =>
                    setDogsitCount(
                      e.target.value === '' ? '' : Number(e.target.value),
                    )
                  }
                  placeholder="0"
                  style={{ width: '100%', padding: '0.3rem' }}
                />
              </label>
            </div>
            <div>
              <div className="muted" style={{ marginBottom: '0.25rem' }}>
                Blocked activities (things you couldn't do):
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
                {COMMON_BLOCKED.map((b) => (
                  <button
                    key={b}
                    type="button"
                    onClick={() => toggleBlocked(b)}
                    style={{
                      padding: '0.2rem 0.5rem',
                      fontSize: '0.85rem',
                      background: blockedSet.has(b) ? 'var(--accent)' : 'transparent',
                      color: blockedSet.has(b) ? 'white' : 'inherit',
                      border: '1px solid var(--border)',
                      borderRadius: '4px',
                    }}
                  >
                    {b}
                  </button>
                ))}
              </div>
            </div>
            <label>
              Tags (comma-separated){' '}
              <input
                type="text"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                placeholder="e.g. dogsit-stress, weather, fatigue"
                style={{ width: '100%', padding: '0.3rem' }}
              />
            </label>
          </div>
        )}
      </div>

      <div className="panel">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            flexWrap: 'wrap',
          }}
        >
          <strong style={{ flex: 1 }}>Entries</strong>
          <div style={{ display: 'flex', gap: '0.3rem' }}>
            {(['range', 'day'] as Mode[]).map((m) => {
              const active = m === mode;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  style={{
                    padding: '0.3rem 0.75rem',
                    borderRadius: '999px',
                    border: '1px solid var(--border)',
                    background: active ? 'var(--accent)' : 'var(--panel)',
                    color: active ? 'var(--accent-fg)' : 'var(--text)',
                    fontSize: '0.82rem',
                    fontWeight: 500,
                  }}
                >
                  {m === 'range' ? 'Range' : 'Single day'}
                </button>
              );
            })}
          </div>
        </div>
        {mode === 'range' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem' }}>
            <span className="muted">last</span>
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              style={{ padding: '0.2rem' }}
            >
              <option value={7}>7 days</option>
              <option value={14}>14 days</option>
              <option value={30}>30 days</option>
              <option value={90}>90 days</option>
            </select>
          </div>
        )}
      </div>

      {mode === 'day' && <DayNavigator date={date} onChange={setDate} />}

      <div className="panel">
        {entries.length === 0 ? (
          <div className="muted">
            {mode === 'range'
              ? `No entries in the last ${days} days.`
              : `No entries on ${formatHeader(date)}.`}
          </div>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, marginTop: '0.5rem' }}>
            {entries.map((e) => (
              <li
                key={String(e._id)}
                style={{
                  padding: '0.6rem 0',
                  borderBottom: '1px solid var(--border)',
                }}
              >
                <div style={{ fontSize: '0.8rem', display: 'flex', gap: '0.5rem' }}>
                  <span className="muted">
                    {new Date(e.ts).toLocaleString()}
                  </span>
                  <span
                    style={{
                      padding: '0 0.3rem',
                      border: '1px solid var(--border)',
                      borderRadius: '3px',
                      fontSize: '0.75rem',
                    }}
                  >
                    {e.related_persona ?? 'both'}
                  </span>
                  <span className="muted" style={{ fontSize: '0.75rem' }}>
                    via {e.source}
                  </span>
                </div>
                <div style={{ marginTop: '0.25rem', whiteSpace: 'pre-wrap' }}>
                  {e.text}
                </div>
                {(e.energy ||
                  e.mood ||
                  typeof e.dogsit_count === 'number' ||
                  (e.blocked_activities && e.blocked_activities.length > 0) ||
                  (e.tags && e.tags.length > 0)) && (
                  <div
                    className="muted"
                    style={{
                      marginTop: '0.3rem',
                      fontSize: '0.8rem',
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '0.4rem',
                    }}
                  >
                    {e.energy && <span>energy: {e.energy}</span>}
                    {e.mood && <span>mood: {e.mood}</span>}
                    {typeof e.dogsit_count === 'number' && (
                      <span>dogs: {e.dogsit_count}</span>
                    )}
                    {e.blocked_activities && e.blocked_activities.length > 0 && (
                      <span>blocked: {e.blocked_activities.join(', ')}</span>
                    )}
                    {e.tags && e.tags.length > 0 && (
                      <span>tags: {e.tags.join(', ')}</span>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
