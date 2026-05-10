import { useEffect, useState } from 'react';
import { api, type AffordabilityReport } from '../api.js';
import type { FilingStatus, TaxEstimate } from '@household-os/shared/types';
import ChatPanel from './ChatPanel.js';

const FILING_OPTIONS: { value: FilingStatus; label: string }[] = [
  { value: 'single', label: 'Single' },
  { value: 'married_jointly', label: 'Married — jointly' },
  { value: 'head_of_household', label: 'Head of household' },
];

export default function FinancePanel() {
  const [report, setReport] = useState<AffordabilityReport | null>(null);
  const [gross, setGross] = useState<number | ''>('');
  const [tax, setTax] = useState<number | ''>('');
  const [fixed, setFixed] = useState<number | ''>('');
  const [state, setState] = useState('');
  const [filing, setFiling] = useState<FilingStatus>('single');
  const [extra, setExtra] = useState<number | ''>('');
  const [notes, setNotes] = useState('');
  const [breakdown, setBreakdown] = useState('');
  const [busy, setBusy] = useState(false);
  const [estimate, setEstimate] = useState<TaxEstimate | null>(null);
  const [estimating, setEstimating] = useState(false);

  async function refresh() {
    const r = await api.finance.affordability();
    setReport(r);
    setGross(r.profile.monthly_gross_income || '');
    setTax(r.profile.monthly_tax_estimate || '');
    setFixed(r.profile.monthly_fixed_expenses || '');
    setState(r.profile.state ?? '');
    setFiling((r.profile.filing_status as FilingStatus) ?? 'single');
    setExtra(r.profile.monthly_extra_withholding || '');
    setNotes(r.profile.notes ?? '');
    setBreakdown(r.profile.expense_breakdown ?? '');
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function save() {
    setBusy(true);
    try {
      await api.finance.setProfile({
        monthly_gross_income: typeof gross === 'number' ? gross : 0,
        monthly_tax_estimate: typeof tax === 'number' ? tax : 0,
        monthly_fixed_expenses: typeof fixed === 'number' ? fixed : 0,
        state,
        filing_status: filing,
        monthly_extra_withholding: typeof extra === 'number' ? extra : 0,
        notes,
        expense_breakdown: breakdown,
      });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function runEstimate() {
    if (typeof gross !== 'number' || gross <= 0) return;
    setEstimating(true);
    try {
      const result = await api.finance.estimateTax({
        monthly_gross_income: gross,
        state,
        filing_status: filing,
        monthly_extra_withholding: typeof extra === 'number' ? extra : 0,
      });
      setEstimate(result);
      setTax(Math.round(result.total));
    } finally {
      setEstimating(false);
    }
  }

  if (!report) return <div className="muted">Loading…</div>;

  const grossNum = typeof gross === 'number' ? gross : 0;
  const taxNum = typeof tax === 'number' ? tax : 0;
  const fixedNum = typeof fixed === 'number' ? fixed : 0;
  const net = Math.max(0, grossNum - taxNum);
  const discretionary = report.discretionary_monthly;
  const outsourceTotal = report.outsourceable.total_monthly_cost;

  return (
    <>
      <div className="panel">
        <strong>Monthly profile</strong>
        <p className="muted" style={{ marginTop: '0.25rem' }}>
          Gross income, estimated tax withholding, fixed expenses. Discretionary = gross − tax − fixed.
          RocketMoney stays your transaction-level dashboard — this is for outsourcing decisions only.
        </p>
        <div style={{ display: 'grid', gap: '0.5rem', maxWidth: '420px' }}>
          <label>
            Monthly gross income{' '}
            <input
              type="number"
              value={gross}
              onChange={(e) =>
                setGross(e.target.value === '' ? '' : Number(e.target.value))
              }
              placeholder="$0"
              style={{ width: '100%', padding: '0.4rem' }}
            />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
            <label>
              State{' '}
              <input
                type="text"
                value={state}
                onChange={(e) => setState(e.target.value.toUpperCase())}
                placeholder="WA"
                maxLength={2}
                style={{ width: '100%', padding: '0.4rem' }}
              />
            </label>
            <label>
              Filing status{' '}
              <select
                value={filing}
                onChange={(e) => setFiling(e.target.value as FilingStatus)}
                style={{ width: '100%', padding: '0.4rem' }}
              >
                {FILING_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Extra withholding (total $/mo across all paychecks){' '}
            <input
              type="number"
              value={extra}
              onChange={(e) =>
                setExtra(e.target.value === '' ? '' : Number(e.target.value))
              }
              placeholder="$0"
              style={{ width: '100%', padding: '0.4rem' }}
            />
          </label>
          <label>
            Monthly tax estimate{' '}
            <input
              type="number"
              value={tax}
              onChange={(e) =>
                setTax(e.target.value === '' ? '' : Number(e.target.value))
              }
              placeholder="$0"
              style={{ width: '100%', padding: '0.4rem' }}
            />
          </label>
          <button
            onClick={runEstimate}
            disabled={estimating || typeof gross !== 'number' || gross <= 0}
            type="button"
          >
            {estimating ? 'Estimating…' : 'Estimate tax from gross + state'}
          </button>
          {estimate && (
            <div
              className="muted"
              style={{
                padding: '0.5rem',
                border: '1px solid var(--border)',
                borderRadius: '4px',
                fontSize: '0.85rem',
              }}
            >
              <div>
                Federal: ${estimate.federal.toLocaleString()} · FICA: $
                {estimate.fica.toLocaleString()} · State: $
                {estimate.state_tax.toLocaleString()} · Extra: $
                {estimate.extra.toLocaleString()}
              </div>
              <div>
                <strong>Total: ${estimate.total.toLocaleString()}/mo</strong> ·
                effective rate {(estimate.effective_rate * 100).toFixed(1)}%
              </div>
              <div style={{ marginTop: '0.25rem' }}>{estimate.notes}</div>
            </div>
          )}
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
        <div style={{ marginTop: '0.75rem', display: 'grid', gap: '0.25rem' }}>
          <div>
            Gross: <strong>${grossNum.toLocaleString()}</strong> − Tax:{' '}
            <strong>${taxNum.toLocaleString()}</strong> = Net:{' '}
            <strong>${net.toLocaleString()}</strong>
          </div>
          <div>
            Net − Fixed (${fixedNum.toLocaleString()}) ={' '}
            <span style={{ color: 'var(--accent)' }}>
              <strong>${discretionary.toLocaleString()}/mo discretionary</strong>
            </span>
          </div>
        </div>
      </div>

      <div className="panel">
        <strong>RocketMoney context (free-form)</strong>
        <p className="muted" style={{ marginTop: '0.25rem' }}>
          Paste anything from RocketMoney that helps the persona reason about your money —
          monthly category breakdown, recurring subscriptions, top spending lines, income split.
          The persona reads this verbatim; no specific format required.
        </p>
        <textarea
          value={breakdown}
          onChange={(e) => setBreakdown(e.target.value)}
          rows={10}
          placeholder={
            'Example:\n\nIncome:\n- Salary: $5,200/mo\n- Side gigs: avg $400/mo\n\nFixed:\n- Rent: $1,800\n- Car insurance: $140\n- Phone: $80\n\nVariable (RocketMoney monthly avg):\n- Groceries: $620\n- Dining out: $280\n- Gas: $180\n\nRecurring subscriptions:\n- Spotify: $11\n- Netflix: $18\n- Adobe: $55'
          }
          style={{
            width: '100%',
            padding: '0.5rem',
            font: 'inherit',
            fontFamily: 'ui-monospace, Menlo, monospace',
            fontSize: '0.85rem',
            border: '1px solid var(--border)',
            borderRadius: '4px',
            marginTop: '0.5rem',
          }}
        />
        <button onClick={save} disabled={busy} style={{ marginTop: '0.5rem' }}>
          {busy ? 'Saving…' : 'Save breakdown'}
        </button>
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
