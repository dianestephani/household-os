import { useRef, useState } from 'react';
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

  const [copied, setCopied] = useState(false);
  const promptRef = useRef<HTMLPreElement | null>(null);

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
          <button onClick={copyPrompt} data-variant="ghost" style={{ fontSize: '0.82rem' }}>
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <p className="muted" style={{ marginTop: '0.25rem', fontSize: '0.84rem' }}>
          This is the system prompt the Project should be configured with. If
          you ever update the prompt here, re-paste it into the Claude Project
          settings so the live chats stay in sync.
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
