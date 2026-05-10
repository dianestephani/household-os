import { useEffect, useState } from 'react';
import { api, type AffordabilityReport } from '../api.js';
import ChatPanel from './ChatPanel.js';

export default function FinancePanel() {
  const [report, setReport] = useState<AffordabilityReport | null>(null);
  const [income, setIncome] = useState<number | ''>('');
  const [fixed, setFixed] = useState<number | ''>('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const r = await api.finance.affordability();
    setReport(r);
    setIncome(r.profile.monthly_income || '');
    setFixed(r.profile.monthly_fixed_expenses || '');
    setNotes(r.profile.notes ?? '');
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function save() {
    setBusy(true);
    try {
      await api.finance.setProfile({
        monthly_income: typeof income === 'number' ? income : 0,
        monthly_fixed_expenses: typeof fixed === 'number' ? fixed : 0,
        notes,
      });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!report) return <div className="muted">Loading…</div>;

  const discretionary = report.discretionary_monthly;
  const outsourceTotal = report.outsourceable.total_monthly_cost;

  return (
    <>
      <div className="panel">
        <strong>Monthly profile</strong>
        <p className="muted" style={{ marginTop: '0.25rem' }}>
          Three numbers. Update when reality shifts. RocketMoney stays your
          transaction-level dashboard — this is just for outsourcing decisions.
        </p>
        <div style={{ display: 'grid', gap: '0.5rem', maxWidth: '320px' }}>
          <label>
            Monthly income (after tax){' '}
            <input
              type="number"
              value={income}
              onChange={(e) =>
                setIncome(e.target.value === '' ? '' : Number(e.target.value))
              }
              placeholder="$0"
              style={{ width: '100%', padding: '0.4rem' }}
            />
          </label>
          <label>
            Monthly fixed expenses{' '}
            <input
              type="number"
              value={fixed}
              onChange={(e) =>
                setFixed(e.target.value === '' ? '' : Number(e.target.value))
              }
              placeholder="$0"
              style={{ width: '100%', padding: '0.4rem' }}
            />
          </label>
          <label>
            Notes (optional){' '}
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              style={{ width: '100%', padding: '0.4rem', font: 'inherit' }}
            />
          </label>
          <button onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
        <div style={{ marginTop: '0.75rem' }}>
          <strong>Discretionary:</strong>{' '}
          <span style={{ color: 'var(--accent)' }}>${discretionary.toLocaleString()}/mo</span>
          <span className="muted"> (income − fixed)</span>
        </div>
      </div>

      <div className="panel">
        <strong>Outsourceable routines</strong>
        <p className="muted" style={{ marginTop: '0.25rem' }}>
          Total if everything were outsourced: <strong>${outsourceTotal.toLocaleString()}/mo</strong>
        </p>
        {report.outsourceable.items.length === 0 ? (
          <div className="muted">No outsourceable routines tagged yet.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '0.5rem' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '0.3rem 0', borderBottom: '1px solid var(--border)' }}>Routine</th>
                <th style={{ textAlign: 'right', padding: '0.3rem 0', borderBottom: '1px solid var(--border)' }}>$/visit</th>
                <th style={{ textAlign: 'right', padding: '0.3rem 0', borderBottom: '1px solid var(--border)' }}>×/mo</th>
                <th style={{ textAlign: 'right', padding: '0.3rem 0', borderBottom: '1px solid var(--border)' }}>$/mo</th>
              </tr>
            </thead>
            <tbody>
              {report.outsourceable.items.map((item) => {
                const fits = report.fits_within_discretionary.some(
                  (f) => f.routine_key === item.routine_key,
                );
                return (
                  <tr key={item.routine_key}>
                    <td style={{ padding: '0.3rem 0', borderBottom: '1px solid var(--border)' }}>
                      {fits && discretionary > 0 ? '✓ ' : ''}
                      {item.routine_name}
                    </td>
                    <td style={{ textAlign: 'right', padding: '0.3rem 0', borderBottom: '1px solid var(--border)' }}>
                      ${item.cost_per_occurrence}
                    </td>
                    <td style={{ textAlign: 'right', padding: '0.3rem 0', borderBottom: '1px solid var(--border)' }}>
                      {item.occurrences_per_month}
                    </td>
                    <td style={{ textAlign: 'right', padding: '0.3rem 0', borderBottom: '1px solid var(--border)' }}>
                      ${item.monthly_cost.toLocaleString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="muted" style={{ marginTop: '0.5rem' }}>
          {report.rationale}
        </p>
      </div>

      <ChatPanel persona="finance" />
    </>
  );
}
