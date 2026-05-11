import { useEffect, useState } from 'react';
import { api } from '../api.js';

/**
 * HARD RULE (mirrors the API + service): this panel only writes to Diane's
 * Alexa Household Shopping List. It never touches an Amazon cart, never
 * places orders, never spends money. The shopping list is a passive
 * checklist for in-person shopping. See §47 Phase 6b in HANDOFF.
 *
 * UX: paste the grocery list Grocery Manager produces → preview parsed
 * items grouped by section → "Send to Alexa Shopping List" bulk-adds them.
 */

interface ParsedItem {
  text: string;
  section: string | null;
}

const SECTION_HEADER_RE = /^#{1,6}\s+(.+?)\s*$/;
const ITEM_RE = /^[-*•]\s+(.+?)\s*$/;

/** Mirrors `apps/api/src/services/grocery-list-parser.ts` exactly. */
function parseGroceryList(raw: string): ParsedItem[] {
  if (!raw) return [];
  let section: string | null = null;
  const items: ParsedItem[] = [];
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^grocery list\s*$/i.test(line)) continue;
    if (/^```/.test(line)) continue;
    const sectionMatch = SECTION_HEADER_RE.exec(line);
    if (sectionMatch) {
      section = sectionMatch[1]!.trim();
      continue;
    }
    const itemMatch = ITEM_RE.exec(line);
    if (itemMatch) {
      const text = itemMatch[1]!.trim();
      if (text) items.push({ text, section });
    }
  }
  return items;
}

type SendStatus =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | {
      kind: 'done';
      added: number;
      failed: number;
      errors: { text: string; error?: string }[];
    }
  | { kind: 'no_token' }
  | { kind: 'error'; message: string };

export default function ShoppingListPanel() {
  const [raw, setRaw] = useState('');
  const [items, setItems] = useState<ParsedItem[]>([]);
  const [status, setStatus] = useState<SendStatus>({ kind: 'idle' });
  const [configured, setConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    void api.alexa
      .authStatus()
      .then((s) => setConfigured(s.configured))
      .catch(() => setConfigured(false));
  }, []);

  // Re-parse whenever raw changes.
  useEffect(() => {
    setItems(parseGroceryList(raw));
    setStatus({ kind: 'idle' });
  }, [raw]);

  async function send() {
    if (items.length === 0) return;
    setStatus({ kind: 'sending' });
    try {
      const result = await api.alexa.addToShoppingList(
        items.map((i) => i.text),
      );
      if (result.status === 'no_token') {
        setStatus({ kind: 'no_token' });
        return;
      }
      const errors = result.results
        .filter((r) => r.status === 'error')
        .map((r) => ({ text: r.text, error: r.error }));
      setStatus({
        kind: 'done',
        added: result.added,
        failed: result.failed,
        errors,
      });
    } catch (err) {
      setStatus({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Send failed',
      });
    }
  }

  const grouped = groupBySection(items);

  return (
    <div className="panel">
      <strong>Send to Alexa Shopping List</strong>
      <p className="muted" style={{ marginTop: '0.25rem', fontSize: '0.88rem' }}>
        Paste the grocery list Grocery Manager produces. We'll parse each
        <code style={{ margin: '0 0.2rem' }}>- item</code> row and push them
        to your Alexa shopping list as separate items. <strong>Read-only —
        never touches an Amazon cart or places orders.</strong>
      </p>

      {configured === false && (
        <div
          style={{
            marginTop: '0.5rem',
            padding: '0.5rem 0.7rem',
            border: '1px dashed var(--border)',
            borderRadius: 6,
            fontSize: '0.85rem',
            color: 'var(--muted)',
          }}
        >
          Alexa Lists permission not configured yet. The send button will
          report an error until you grant the skill "Lists Read/Write" in the
          Alexa app and we've stored an access token.
        </div>
      )}

      <textarea
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        rows={8}
        placeholder={
          'GROCERY LIST\n## Produce\n- 1 lb baby spinach\n- 2 lemons\n\n## Frozen\n- 2 bags TJ\'s frozen rice'
        }
        style={{
          width: '100%',
          padding: '0.55rem',
          marginTop: '0.5rem',
          fontFamily: 'ui-monospace, Menlo, monospace',
          fontSize: '0.82rem',
        }}
      />

      {items.length > 0 && (
        <div style={{ marginTop: '0.6rem' }}>
          <div style={{ fontSize: '0.85rem', marginBottom: '0.3rem' }}>
            <strong>{items.length}</strong> item{items.length === 1 ? '' : 's'}{' '}
            parsed
            {Object.keys(grouped).length > 1 && (
              <span className="muted">
                {' '}
                across {Object.keys(grouped).length} sections
              </span>
            )}
          </div>
          <details>
            <summary
              className="muted"
              style={{ fontSize: '0.8rem', cursor: 'pointer' }}
            >
              Preview parsed list ▾
            </summary>
            <div
              style={{
                marginTop: '0.4rem',
                padding: '0.5rem',
                background: 'var(--bg)',
                border: '1px solid var(--border)',
                borderRadius: 4,
                fontSize: '0.8rem',
                maxHeight: '14rem',
                overflowY: 'auto',
              }}
            >
              {Object.entries(grouped).map(([section, list]) => (
                <div key={section} style={{ marginBottom: '0.4rem' }}>
                  <strong>{section}</strong>
                  <ul style={{ margin: '0.2rem 0 0 1rem', padding: 0 }}>
                    {list.map((it, i) => (
                      <li key={i}>{it.text}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </details>
        </div>
      )}

      <button
        onClick={send}
        disabled={
          items.length === 0 || status.kind === 'sending' || configured === false
        }
        style={{ marginTop: '0.6rem' }}
        title={
          configured === false
            ? 'Connect Alexa Lists permission first (see help text above)'
            : undefined
        }
      >
        {status.kind === 'sending'
          ? 'Sending…'
          : `Send ${items.length} item${items.length === 1 ? '' : 's'} to Alexa`}
      </button>

      {status.kind === 'done' && (
        <div
          style={{
            marginTop: '0.5rem',
            fontSize: '0.85rem',
            color: status.failed === 0 ? 'var(--good)' : 'var(--text)',
          }}
        >
          ✓ Sent {status.added} of {status.added + status.failed} to your Alexa
          shopping list.
          {status.errors.length > 0 && (
            <ul style={{ margin: '0.3rem 0 0 1rem' }}>
              {status.errors.slice(0, 5).map((e, i) => (
                <li key={i}>
                  <span style={{ color: 'var(--bad)' }}>✕</span> {e.text}{' '}
                  <span className="muted">({e.error ?? 'unknown'})</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {status.kind === 'no_token' && (
        <div
          style={{
            marginTop: '0.5rem',
            fontSize: '0.85rem',
            color: 'var(--bad)',
          }}
        >
          Alexa Lists permission isn't configured yet — see the note above.
        </div>
      )}

      {status.kind === 'error' && (
        <div
          style={{
            marginTop: '0.5rem',
            fontSize: '0.85rem',
            color: 'var(--bad)',
          }}
        >
          {status.message}
        </div>
      )}
    </div>
  );
}

function groupBySection(items: ParsedItem[]): Record<string, ParsedItem[]> {
  const out: Record<string, ParsedItem[]> = {};
  for (const it of items) {
    const key = it.section ?? '(no section)';
    out[key] = out[key] ? [...out[key]!, it] : [it];
  }
  return out;
}
