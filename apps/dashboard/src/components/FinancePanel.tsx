import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type AffordabilityReport } from '../api.js';
import type {
  FilingStatus,
  FinancialProfile,
  FinancialProfileSnapshot,
  ImportKind,
  RocketMoneyImport,
  SnapshotSource,
  TaxEstimate,
} from '@household-os/shared/types';

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
  const [busy, setBusy] = useState(false);
  const [importsReloadKey, setImportsReloadKey] = useState(0);
  const [snapshotsReloadKey, setSnapshotsReloadKey] = useState(0);
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
      });
      await refresh();
      // Profile saves write a snapshot — refresh that list too.
      setSnapshotsReloadKey((k) => k + 1);
    } finally {
      setBusy(false);
    }
  }

  const handleImportApplied = useCallback(
    async (updatedProfile: FinancialProfile) => {
      // Don't trash the in-progress form state — just refresh the report
      // (discretionary, etc.) and bump both history lists. The
      // `expense_breakdown` lives on the profile but isn't a form field
      // anymore, so we don't sync it back into local state.
      void updatedProfile;
      const r = await api.finance.affordability();
      setReport(r);
      setImportsReloadKey((k) => k + 1);
      setSnapshotsReloadKey((k) => k + 1);
    },
    [],
  );

  const handleSnapshotRestored = useCallback(async () => {
    await refresh();
    setSnapshotsReloadKey((k) => k + 1);
  }, []);

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

      <FinanceImports
        reloadKey={importsReloadKey}
        currentBreakdown={report.profile.expense_breakdown ?? ''}
        onApplied={handleImportApplied}
      />

      <FinanceSnapshots
        reloadKey={snapshotsReloadKey}
        onRestored={handleSnapshotRestored}
      />

      <div className="panel">
        <strong>Outsourceable routines</strong>
        <p className="muted" style={{ marginTop: '0.25rem' }}>
          Total if everything were outsourced: <strong>${outsourceTotal.toLocaleString()}/mo</strong>
        </p>
        {report.outsourceable.items.length === 0 ? (
          <div className="muted">No outsourceable routines tagged yet.</div>
        ) : (
          <div
            style={{
              overflowX: 'auto',
              marginTop: '0.5rem',
              WebkitOverflowScrolling: 'touch',
            }}
          >
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '24rem' }}>
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
          </div>
        )}
        <p className="muted" style={{ marginTop: '0.5rem' }}>
          {report.rationale}
        </p>
      </div>

    </>
  );
}

// =====================================================================
// FinanceImports — §47 Phase 5
// =====================================================================

const SOURCE_LABEL: Record<SnapshotSource, string> = {
  dashboard_edit: 'profile edit',
  paste_import: 'paste',
  csv_import: 'CSV',
  restore: 'restore',
};

function fmtTs(ts: Date | string): string {
  const d = new Date(ts);
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

interface FinanceImportsProps {
  reloadKey: number;
  currentBreakdown: string;
  onApplied: (profile: FinancialProfile) => void | Promise<void>;
}

function FinanceImports({
  reloadKey,
  currentBreakdown,
  onApplied,
}: FinanceImportsProps) {
  const [mode, setMode] = useState<ImportKind>('paste');
  const [paste, setPaste] = useState('');
  const [csvText, setCsvText] = useState('');
  const [csvFilename, setCsvFilename] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imports, setImports] = useState<RocketMoneyImport[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void api.finance.imports.list().then(setImports).catch(() => setImports([]));
  }, [reloadKey]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1_000_000) {
      setError(`File too large (${(file.size / 1024).toFixed(0)} KB) — max 1 MB`);
      return;
    }
    setError(null);
    const text = await file.text();
    setCsvText(text);
    setCsvFilename(file.name);
  }

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const isCsv = mode === 'csv';
      const raw = isCsv ? csvText : paste;
      if (!raw.trim()) {
        throw new Error(isCsv ? 'Pick a CSV file first' : 'Paste something first');
      }
      const created = await api.finance.imports.create({
        kind: mode,
        raw,
        filename: isCsv ? csvFilename : undefined,
      });
      // Reset inputs but stay on the same mode
      if (isCsv) {
        setCsvText('');
        setCsvFilename(undefined);
        if (fileInputRef.current) fileInputRef.current.value = '';
      } else {
        setPaste('');
      }
      setImports((prev) => [created, ...(prev ?? [])]);
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^[\d]+ /, '') : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  async function apply(importId: string) {
    setError(null);
    setBusy(true);
    try {
      const result = await api.finance.imports.apply(importId);
      await onApplied(result.profile);
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^[\d]+ /, '') : 'Apply failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <strong>RocketMoney imports</strong>
      <p className="muted" style={{ marginTop: '0.25rem' }}>
        Drop a CSV from RocketMoney, or paste a free-form summary. The Finance
        persona reads the applied breakdown to answer affordability questions.
        Imports are kept as history — apply one to make it the active context.
      </p>

      <div
        className="pill-toggle"
        role="tablist"
        style={{ marginTop: '0.6rem', marginBottom: '0.6rem' }}
      >
        <button
          className={mode === 'paste' ? 'active' : ''}
          onClick={() => setMode('paste')}
          role="tab"
          type="button"
        >
          Paste
        </button>
        <button
          className={mode === 'csv' ? 'active' : ''}
          onClick={() => setMode('csv')}
          role="tab"
          type="button"
        >
          CSV upload
        </button>
      </div>

      {mode === 'paste' ? (
        <textarea
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          rows={6}
          placeholder={
            'Income:\n- Salary: $5,200/mo\n- Side gigs: avg $400/mo\n\nVariable (RocketMoney monthly avg):\n- Groceries: $620\n- Dining out: $280\n- Gas: $180'
          }
          style={{
            width: '100%',
            padding: '0.5rem',
            fontFamily: 'ui-monospace, Menlo, monospace',
            fontSize: '0.82rem',
          }}
        />
      ) : (
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => void onFile(e)}
            style={{ fontSize: '0.85rem' }}
          />
          {csvFilename && (
            <div className="muted" style={{ fontSize: '0.8rem', marginTop: '0.4rem' }}>
              Loaded {csvFilename} · {csvText.length.toLocaleString()} chars.
              Parsing happens on the server; if the columns don't match
              expectations, the raw is still saved.
            </div>
          )}
        </div>
      )}

      {error && (
        <div style={{ color: 'var(--bad)', fontSize: '0.85rem', marginTop: '0.4rem' }}>
          {error}
        </div>
      )}

      <button
        onClick={submit}
        disabled={busy || (mode === 'paste' ? !paste.trim() : !csvText.trim())}
        style={{ marginTop: '0.5rem' }}
      >
        {busy ? 'Saving…' : `Save ${mode === 'paste' ? 'paste' : 'CSV'} import`}
      </button>

      {/* History */}
      <div style={{ marginTop: '1rem' }}>
        <strong style={{ fontSize: '0.85rem' }}>History</strong>
        {!imports ? (
          <div className="muted" style={{ fontSize: '0.85rem', marginTop: '0.3rem' }}>
            Loading…
          </div>
        ) : imports.length === 0 ? (
          <div className="muted" style={{ fontSize: '0.85rem', marginTop: '0.3rem' }}>
            No imports yet.
          </div>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: '0.4rem 0 0 0' }}>
            {imports.map((imp) => {
              const id = String(imp._id);
              const isExpanded = expanded === id;
              const isApplied = !!imp.applied_to_snapshot_id;
              return (
                <li
                  key={id}
                  style={{
                    padding: '0.4rem 0',
                    borderBottom: '1px solid var(--border)',
                    fontSize: '0.85rem',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      gap: '0.5rem',
                      alignItems: 'baseline',
                      flexWrap: 'wrap',
                    }}
                  >
                    <span style={{ flex: 1 }}>
                      <strong>{imp.kind === 'csv' ? '📄 CSV' : '📝 Paste'}</strong>
                      {imp.filename && (
                        <span className="muted"> · {imp.filename}</span>
                      )}
                      {imp.parsed && (
                        <span className="muted">
                          {' '}· {imp.parsed.categories.length} categories ·
                          ${imp.parsed.total.toFixed(0)}
                        </span>
                      )}
                      {imp.kind === 'csv' && !imp.parsed && (
                        <span className="muted"> · parse failed (raw saved)</span>
                      )}
                      {isApplied && (
                        <span style={{ color: 'var(--good)' }}> · applied</span>
                      )}
                    </span>
                    <span className="muted" style={{ fontSize: '0.78rem' }}>
                      {fmtTs(imp.ts)}
                    </span>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      gap: '0.3rem',
                      marginTop: '0.3rem',
                      flexWrap: 'wrap',
                    }}
                  >
                    <button
                      className="icon-btn"
                      onClick={() => setExpanded(isExpanded ? null : id)}
                    >
                      {isExpanded ? 'Hide' : 'View'}
                    </button>
                    <button
                      className="icon-btn"
                      onClick={() => void apply(id)}
                      disabled={busy}
                      title="Replace expense_breakdown with this import + write a snapshot"
                    >
                      Apply to profile
                    </button>
                  </div>
                  {isExpanded && (
                    <pre
                      style={{
                        marginTop: '0.4rem',
                        padding: '0.5rem',
                        background: 'var(--bg)',
                        border: '1px solid var(--border)',
                        borderRadius: '4px',
                        fontFamily: 'ui-monospace, Menlo, monospace',
                        fontSize: '0.75rem',
                        lineHeight: 1.4,
                        whiteSpace: 'pre-wrap',
                        maxHeight: '16rem',
                        overflowY: 'auto',
                      }}
                    >
                      {imp.raw}
                    </pre>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {currentBreakdown && (
        <details style={{ marginTop: '0.8rem' }}>
          <summary
            className="muted"
            style={{ fontSize: '0.82rem', cursor: 'pointer' }}
          >
            Current expense_breakdown (preview) ▾
          </summary>
          <pre
            style={{
              marginTop: '0.4rem',
              padding: '0.5rem',
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              borderRadius: '4px',
              fontFamily: 'ui-monospace, Menlo, monospace',
              fontSize: '0.78rem',
              whiteSpace: 'pre-wrap',
              maxHeight: '10rem',
              overflowY: 'auto',
            }}
          >
            {currentBreakdown}
          </pre>
        </details>
      )}
    </div>
  );
}

// =====================================================================
// FinanceSnapshots — §47 Phase 5
// =====================================================================

interface FinanceSnapshotsProps {
  reloadKey: number;
  onRestored: () => void | Promise<void>;
}

function FinanceSnapshots({ reloadKey, onRestored }: FinanceSnapshotsProps) {
  const [snapshots, setSnapshots] = useState<FinancialProfileSnapshot[] | null>(
    null,
  );
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.finance.snapshots
      .list()
      .then(setSnapshots)
      .catch(() => setSnapshots([]));
  }, [reloadKey]);

  async function restore(id: string) {
    if (
      !window.confirm(
        'Restore this snapshot? Current profile values will be overwritten and a new "restore" snapshot will be added to history.',
      )
    ) {
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await api.finance.snapshots.restore(id);
      await onRestored();
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^[\d]+ /, '') : 'Restore failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <strong>Profile history</strong>
      <p className="muted" style={{ marginTop: '0.25rem' }}>
        Every profile save, import apply, or restore writes a snapshot here.
        Newest first. Click to view; restore reverts the live profile and
        writes a new "restore" snapshot so you keep the trail.
      </p>
      {error && (
        <div style={{ color: 'var(--bad)', fontSize: '0.85rem', marginTop: '0.4rem' }}>
          {error}
        </div>
      )}
      {!snapshots ? (
        <div className="muted" style={{ fontSize: '0.85rem', marginTop: '0.3rem' }}>
          Loading…
        </div>
      ) : snapshots.length === 0 ? (
        <div className="muted" style={{ fontSize: '0.85rem', marginTop: '0.3rem' }}>
          No snapshots yet — save the profile or apply an import to create one.
        </div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: '0.4rem 0 0 0' }}>
          {snapshots.map((s) => {
            const id = String(s._id);
            const isExpanded = expanded === id;
            const src = s.source as SnapshotSource;
            return (
              <li
                key={id}
                style={{
                  padding: '0.4rem 0',
                  borderBottom: '1px solid var(--border)',
                  fontSize: '0.85rem',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    gap: '0.5rem',
                    alignItems: 'baseline',
                    flexWrap: 'wrap',
                  }}
                >
                  <span style={{ flex: 1 }}>
                    <strong>{SOURCE_LABEL[src] ?? src}</strong>
                    {s.profile && (
                      <span className="muted">
                        {' '}· gross ${(s.profile.monthly_gross_income ?? 0).toLocaleString()}
                        {' '}· fixed ${(s.profile.monthly_fixed_expenses ?? 0).toLocaleString()}
                      </span>
                    )}
                  </span>
                  <span className="muted" style={{ fontSize: '0.78rem' }}>
                    {fmtTs(s.ts)}
                  </span>
                </div>
                <div
                  style={{
                    display: 'flex',
                    gap: '0.3rem',
                    marginTop: '0.3rem',
                    flexWrap: 'wrap',
                  }}
                >
                  <button
                    className="icon-btn"
                    onClick={() => setExpanded(isExpanded ? null : id)}
                  >
                    {isExpanded ? 'Hide' : 'View'}
                  </button>
                  <button
                    className="icon-btn"
                    onClick={() => void restore(id)}
                    disabled={busy}
                    title="Replace the live profile with this snapshot's values"
                  >
                    Restore
                  </button>
                </div>
                {isExpanded && (
                  <pre
                    style={{
                      marginTop: '0.4rem',
                      padding: '0.5rem',
                      background: 'var(--bg)',
                      border: '1px solid var(--border)',
                      borderRadius: '4px',
                      fontFamily: 'ui-monospace, Menlo, monospace',
                      fontSize: '0.75rem',
                      lineHeight: 1.4,
                      whiteSpace: 'pre-wrap',
                      maxHeight: '16rem',
                      overflowY: 'auto',
                    }}
                  >
                    {JSON.stringify(s.profile, null, 2)}
                  </pre>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
