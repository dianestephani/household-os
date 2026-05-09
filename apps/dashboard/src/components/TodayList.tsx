import { useState } from 'react';
import { api } from '../api.js';
import DeferDialog from './DeferDialog.js';
import type { DeferReasonCode, TodayPlan } from '@household-os/shared/types';

interface Props {
  plan: TodayPlan;
  onChange: (plan: TodayPlan) => void;
}

export default function TodayList({ plan, onChange }: Props) {
  const [showPool, setShowPool] = useState(false);
  const [deferring, setDeferring] = useState<{ key: string; name: string } | null>(null);
  const used = plan.items.reduce((acc, it) => acc + (it.estimate_minutes ?? 0), 0);

  async function confirmDefer(reason: DeferReasonCode, notes: string) {
    if (!deferring) return;
    const updated = await api.today.swap(deferring.key, undefined, reason, notes || undefined);
    onChange(updated);
    setDeferring(null);
  }

  return (
    <div className="panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
        <strong>Today — {plan.date}</strong>
        <span className="muted">
          {used} / {plan.budget_minutes} min · {plan.day_type}
        </span>
      </div>

      {plan.items.length === 0 && <div className="muted">Nothing scheduled.</div>}

      {plan.items.map((it) => (
        <div key={it.routine_key} className={`row ${it.status === 'done' ? 'done' : ''}`}>
          <button
            className="icon-btn"
            onClick={async () => onChange(await api.today.markDone(it.routine_key))}
          >
            {it.status === 'done' ? '✓' : '○'}
          </button>
          <span className="name">{it.name}</span>
          <span className="meta">
            {it.estimate_minutes}m · {it.energy}
          </span>
          <button
            className="icon-btn"
            onClick={() => setDeferring({ key: it.routine_key, name: it.name })}
          >
            defer
          </button>
        </div>
      ))}

      {plan.swap_pool.length > 0 && (
        <div style={{ marginTop: '0.75rem' }}>
          <button className="icon-btn" onClick={() => setShowPool(!showPool)}>
            {showPool ? '▾' : '▸'} Swap pool ({plan.swap_pool.length})
          </button>
          {showPool &&
            plan.swap_pool.map((p) => (
              <div key={p.routine_key} className="row">
                <span className="name muted">{p.name}</span>
                <span className="meta">
                  {p.estimate_minutes}m · {p.energy}
                </span>
                <button
                  className="icon-btn"
                  onClick={async () =>
                    onChange(await api.today.pullFromPool(p.routine_key))
                  }
                >
                  pull in
                </button>
              </div>
            ))}
        </div>
      )}

      {deferring && (
        <DeferDialog
          itemName={deferring.name}
          onConfirm={confirmDefer}
          onCancel={() => setDeferring(null)}
        />
      )}
    </div>
  );
}
