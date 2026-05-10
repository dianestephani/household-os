import { useEffect, useRef, useState } from 'react';
import { household } from '@household-os/shared/personas/household';
import { finance } from '@household-os/shared/personas/finance';
import { grocery } from '@household-os/shared/personas/grocery';
import type { PersonaConfig } from '@household-os/shared/types';

type PersonaName = 'household' | 'finance' | 'grocery';

const CONFIGS: Record<PersonaName, PersonaConfig> = {
  household,
  finance,
  grocery,
};

const BLURB: Record<PersonaName, string> = {
  household:
    "Your household ops thinking partner. Energy management, prioritizing chores, talking through deferrals and patterns.",
  finance:
    "Your outsourcing & affordability sounding board. Tax estimates, monthly budget questions, what to outsource and when.",
  grocery:
    "Your food planning + shopping assistant. Meal ideas built around TJ's, no-seafood / no-raw-meat constraints, 100g+ protein target, weight-loss-aware. Produces a parsable grocery list at the end.",
};

/**
 * Per-persona hardcoded Project URL. The launcher uses this when no
 * user-saved URL exists in localStorage. Means the "Open in Claude.ai"
 * button always lands somewhere sensible even on first use. Users can
 * still override via the "Saved Project URL" input.
 */
const DEFAULT_PROJECT_URL: Partial<Record<PersonaName, string>> = {
  grocery: 'https://claude.ai/project/019e141a-8cbc-720d-843a-0732ad1293c2',
};

const HOSTED_FALLBACK = 'https://claude.ai/new';

export default function PersonaLauncher({ persona }: { persona: PersonaName }) {
  const config = CONFIGS[persona];
  const blurb = BLURB[persona];
  const storageKey = `persona-project-url-${persona}`;

  const [projectUrl, setProjectUrl] = useState('');
  const [savedHint, setSavedHint] = useState(false);
  const [copied, setCopied] = useState(false);
  const promptRef = useRef<HTMLPreElement | null>(null);

  useEffect(() => {
    try {
      setProjectUrl(localStorage.getItem(storageKey) ?? '');
    } catch {
      /* localStorage unavailable */
    }
  }, [storageKey]);

  const target =
    projectUrl.trim() || DEFAULT_PROJECT_URL[persona] || HOSTED_FALLBACK;

  function saveProjectUrl() {
    try {
      const v = projectUrl.trim();
      if (v) localStorage.setItem(storageKey, v);
      else localStorage.removeItem(storageKey);
      setSavedHint(true);
      setTimeout(() => setSavedHint(false), 1500);
    } catch {
      /* localStorage unavailable */
    }
  }

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(config.systemPrompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Fallback: select the <pre> for manual copy
      const node = promptRef.current;
      if (!node) return;
      const range = document.createRange();
      range.selectNodeContents(node);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  }

  return (
    <>
      <div className="panel">
        <strong>{config.name}</strong>
        <p className="muted" style={{ marginTop: '0.4rem' }}>
          {blurb}
        </p>

        <div
          style={{
            display: 'flex',
            gap: '0.5rem',
            alignItems: 'center',
            flexWrap: 'wrap',
            marginTop: '0.75rem',
          }}
        >
          <a
            href={target}
            target="_blank"
            rel="noopener noreferrer"
            className="theme-toggle"
            style={{
              background: 'var(--accent)',
              color: 'var(--accent-fg)',
              borderColor: 'var(--accent)',
              textDecoration: 'none',
              padding: '0.5rem 1rem',
              fontSize: '0.85rem',
            }}
          >
            Open in Claude.ai →
          </a>
          <span className="muted" style={{ fontSize: '0.82rem' }}>
            {projectUrl.trim()
              ? 'Goes to your saved Project.'
              : DEFAULT_PROJECT_URL[persona]
                ? 'Goes to the linked Claude Project. Set a custom URL below to override.'
                : 'Goes to claude.ai/new — set up a Project below for a persistent chat.'}
          </span>
        </div>
      </div>

      <div className="panel">
        <strong>Saved Claude Project URL (optional)</strong>
        <p className="muted" style={{ marginTop: '0.25rem', fontSize: '0.88rem' }}>
          One-time setup: on Claude.ai, create a new Project, paste the system prompt below into the
          Project's instructions, save it, copy that Project's URL, and paste it here. After that the
          launcher takes you straight into the Project (history stays organized per persona).
        </p>
        <div
          style={{
            display: 'flex',
            gap: '0.5rem',
            marginTop: '0.5rem',
            flexWrap: 'wrap',
          }}
        >
          <input
            type="url"
            value={projectUrl}
            onChange={(e) => setProjectUrl(e.target.value)}
            placeholder="https://claude.ai/project/…"
            style={{ flex: 1, minWidth: '20rem' }}
          />
          <button onClick={saveProjectUrl} data-variant="ghost">
            {savedHint ? 'Saved' : 'Save'}
          </button>
        </div>
      </div>

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
          <button onClick={copyPrompt} data-variant="ghost" style={{ fontSize: '0.82rem' }}>
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <p className="muted" style={{ marginTop: '0.25rem', fontSize: '0.84rem' }}>
          Heads up: this prompt assumes the persona can call tools (e.g. <code>get_today</code>,{' '}
          <code>affordability_report</code>). On Claude.ai those tools won't exist, so the persona is
          advisory only — it can think with you but can't change anything in this dashboard. If you
          want, trim out the tool-specific sentences before pasting.
        </p>
        <pre
          ref={promptRef}
          style={{
            marginTop: '0.5rem',
            padding: '0.75rem',
            background: 'var(--bg)',
            border: '1px solid var(--border)',
            borderRadius: '6px',
            fontFamily: 'ui-monospace, Menlo, monospace',
            fontSize: '0.82rem',
            lineHeight: 1.5,
            whiteSpace: 'pre-wrap',
            maxHeight: '24rem',
            overflowY: 'auto',
          }}
        >
          {config.systemPrompt}
        </pre>
      </div>
    </>
  );
}
