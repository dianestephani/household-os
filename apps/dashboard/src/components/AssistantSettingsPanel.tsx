import { useEffect, useState } from 'react';
import { api } from '../api.js';
import type { AssistantSettingsView } from '../api.js';

/**
 * §50 Phase C — Stuff/Assistant Settings sub-tab. Textarea for the live
 * system prompt, version list with rollback, "reset to seed" button.
 * Phase E may refine the layout; this is the working baseline.
 */

const DATETIME_FMT = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

export default function AssistantSettingsPanel() {
  const [settings, setSettings] = useState<AssistantSettingsView | null>(null);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  async function load() {
    try {
      const s = await api.assistantSettings.get();
      setSettings(s);
      setDraft(s.system_prompt);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const dirty = settings ? draft !== settings.system_prompt : false;

  async function handleSave() {
    if (!dirty) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await api.assistantSettings.update(draft);
      setSettings(updated);
      setDraft(updated.system_prompt);
      setSavedAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    if (
      !window.confirm(
        'Reset the system prompt to the seed from code? This pushes a new version (rollback is still possible).',
      )
    )
      return;
    setSaving(true);
    setError(null);
    try {
      const reset = await api.assistantSettings.reset();
      setSettings(reset);
      setDraft(reset.system_prompt);
      setSavedAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleRollback(idx: number) {
    if (!settings) return;
    const target = settings.versions[idx];
    if (!target) return;
    if (
      !window.confirm(
        `Roll back to the version saved on ${DATETIME_FMT.format(new Date(target.ts))}? This pushes it as a new 'user' version on top of history.`,
      )
    )
      return;
    setDraft(target.system_prompt);
    setSaving(true);
    setError(null);
    try {
      const updated = await api.assistantSettings.update(target.system_prompt);
      setSettings(updated);
      setDraft(updated.system_prompt);
      setSavedAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="panel">
        <strong>Assistant settings</strong>
        <div className="muted" style={{ marginTop: '0.4rem' }}>
          Loading…
        </div>
      </div>
    );
  }

  if (error && !settings) {
    return (
      <div className="panel">
        <strong>Assistant settings</strong>
        <div className="muted" style={{ marginTop: '0.4rem', color: 'var(--bad)' }}>
          {error}
        </div>
      </div>
    );
  }

  const versions = settings?.versions ?? [];

  return (
    <>
      <div className="panel">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            gap: '0.5rem',
            flexWrap: 'wrap',
          }}
        >
          <strong>System prompt</strong>
          <span className="muted" style={{ fontSize: '0.82rem' }}>
            {settings?.model} ·{' '}
            {settings?.updated_at &&
              `updated ${DATETIME_FMT.format(new Date(settings.updated_at))}`}
          </span>
        </div>

        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={16}
          disabled={saving}
          style={{
            display: 'block',
            width: '100%',
            marginTop: '0.5rem',
            padding: '0.6rem 0.7rem',
            border: '1px solid var(--border)',
            borderRadius: '6px',
            background: 'var(--bg)',
            color: 'var(--text)',
            fontFamily: 'ui-monospace, Menlo, monospace',
            fontSize: '0.88rem',
            lineHeight: 1.5,
            resize: 'vertical',
            boxSizing: 'border-box',
            whiteSpace: 'pre-wrap',
          }}
        />

        {error && (
          <div className="muted" style={{ marginTop: '0.4rem', color: 'var(--bad)' }}>
            {error}
          </div>
        )}

        <div
          style={{
            marginTop: '0.6rem',
            display: 'flex',
            gap: '0.5rem',
            alignItems: 'baseline',
            flexWrap: 'wrap',
          }}
        >
          <button
            type="button"
            className="theme-toggle"
            onClick={handleSave}
            disabled={!dirty || saving}
            style={{ opacity: !dirty || saving ? 0.5 : 1 }}
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          <button
            type="button"
            className="theme-toggle"
            onClick={handleReset}
            disabled={saving}
          >
            Reset to seed
          </button>
          {savedAt && (
            <span
              className="muted"
              style={{ fontSize: '0.8rem', color: 'var(--good)' }}
            >
              ✓ Saved at {TIME_FMT.format(savedAt)}
            </span>
          )}
        </div>
      </div>

      <div className="panel" style={{ marginTop: '1rem' }}>
        <strong>Version history</strong>
        <div
          className="muted"
          style={{ marginTop: '0.25rem', fontSize: '0.82rem' }}
        >
          Every save pushes a new version. Rollback writes the chosen version
          back as the current prompt.
        </div>
        {versions.length === 0 && (
          <div className="muted" style={{ marginTop: '0.5rem' }}>
            No versions yet.
          </div>
        )}
        <ul
          style={{
            listStyle: 'none',
            padding: 0,
            margin: '0.5rem 0 0 0',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.4rem',
          }}
        >
          {[...versions].reverse().map((v, i) => {
            const originalIdx = versions.length - 1 - i;
            const preview = v.system_prompt.slice(0, 80).replace(/\s+/g, ' ');
            return (
              <li
                key={`${v.ts}-${originalIdx}`}
                style={{
                  padding: '0.5rem 0.6rem',
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    gap: '0.5rem',
                    flexWrap: 'wrap',
                  }}
                >
                  <span style={{ fontSize: '0.88rem' }}>
                    {DATETIME_FMT.format(new Date(v.ts))}{' '}
                    <span
                      className="muted"
                      style={{ fontSize: '0.78rem', marginLeft: '0.3rem' }}
                    >
                      {v.edited_by === 'seed' ? '(seed)' : '(edit)'}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="theme-toggle"
                    onClick={() => void handleRollback(originalIdx)}
                    disabled={saving}
                    style={{ fontSize: '0.8rem' }}
                  >
                    Roll back
                  </button>
                </div>
                <div
                  className="muted"
                  style={{
                    marginTop: '0.25rem',
                    fontSize: '0.82rem',
                    fontFamily: 'ui-monospace, Menlo, monospace',
                  }}
                >
                  {preview}
                  {v.system_prompt.length > 80 ? '…' : ''}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}

const TIME_FMT = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
});
