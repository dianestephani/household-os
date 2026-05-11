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
 * Hosted fallback for personas without a `projectUrl` set on their config.
 * In practice all three live personas have one; this is just defensive.
 */
const HOSTED_FALLBACK = 'https://claude.ai/new';

export default function PersonaLauncher({ persona }: { persona: PersonaName }) {
  const config = CONFIGS[persona];
  const blurb = BLURB[persona];
  const target = config.projectUrl ?? HOSTED_FALLBACK;

  // The prompt is shown read-only by default so it can't be accidentally
  // edited while Diane is just scrolling / copying. `Edit` flips the textarea
  // editable; edits are local to this session (not persisted, not synced back
  // to the persona config in the repo). She can copy the edited text into the
  // Claude Project settings if she wants a one-off variant.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(config.systemPrompt);
  const [copied, setCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // When the persona changes (or the canonical prompt updates on hot reload),
  // discard any in-flight draft so we don't display stale text under a new
  // persona's header.
  useEffect(() => {
    setDraft(config.systemPrompt);
    setEditing(false);
  }, [config.systemPrompt]);

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(draft);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Fallback: select the textarea for manual copy
      const node = textareaRef.current;
      if (!node) return;
      node.focus();
      node.select();
    }
  }

  function resetDraft() {
    setDraft(config.systemPrompt);
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
            Opens this persona's Claude Project. On iOS, prompts to open in the
            Claude app if installed.
          </span>
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
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            {editing && (
              <button
                onClick={resetDraft}
                data-variant="ghost"
                style={{ fontSize: '0.82rem' }}
                title="Restore the prompt to the canonical version from the repo"
              >
                Reset
              </button>
            )}
            <button
              onClick={() => setEditing((v) => !v)}
              data-variant="ghost"
              style={{ fontSize: '0.82rem' }}
            >
              {editing ? 'Done' : 'Edit'}
            </button>
            <button
              onClick={copyPrompt}
              data-variant="ghost"
              style={{ fontSize: '0.82rem' }}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
        <p className="muted" style={{ marginTop: '0.25rem', fontSize: '0.82rem' }}>
          {editing
            ? "Edits are local to this page — they don't change the canonical prompt in the repo. Copy your edited version and paste it into the Claude Project settings."
            : 'Read-only. Hit Edit to tweak before copying.'}
        </p>
        <textarea
          ref={textareaRef}
          readOnly={!editing}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={6}
          spellCheck={false}
          style={{
            marginTop: '0.5rem',
            width: '100%',
            padding: '0.65rem',
            background: editing ? 'var(--panel)' : 'var(--bg)',
            border: '1px solid var(--border)',
            borderRadius: '6px',
            fontFamily: 'ui-monospace, Menlo, monospace',
            fontSize: '0.8rem',
            lineHeight: 1.5,
            resize: 'vertical',
            color: editing ? 'var(--text)' : 'var(--muted)',
            cursor: editing ? 'text' : 'default',
          }}
        />
      </div>
    </>
  );
}
