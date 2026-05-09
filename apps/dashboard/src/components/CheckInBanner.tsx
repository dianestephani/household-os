import { useEffect, useState } from 'react';
import { api } from '../api.js';
import type { CheckIn, CheckInQuestion } from '@household-os/shared/types';

const TYPE_LABEL: Record<CheckIn['type'], string> = {
  morning_intent: 'Morning check-in',
  evening_retro: 'Evening retro',
  weekly_review: 'Weekly review',
  pattern_interrupt: 'Pattern interrupt',
  zone_assessment: 'Zone check-in',
};

export default function CheckInBanner() {
  const [pending, setPending] = useState<CheckIn[] | null>(null);
  const [open, setOpen] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      setPending(await api.checkins.pending());
    } catch {
      setPending([]);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  if (!pending || pending.length === 0) return null;
  const top = pending[0]!;

  async function submit() {
    if (!top) return;
    setBusy(true);
    try {
      await api.checkins.answer(top._id!, answers);
      setAnswers({});
      setOpen(false);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function skip() {
    if (!top) return;
    setBusy(true);
    try {
      await api.checkins.skip(top._id!);
      setOpen(false);
      setAnswers({});
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="panel"
      style={{
        borderLeft: '3px solid var(--accent)',
        background: 'rgba(196, 90, 59, 0.06)',
      }}
    >
      {!open ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <strong style={{ flex: 1 }}>
            {TYPE_LABEL[top.type]}
            {pending.length > 1 && (
              <span className="muted"> · +{pending.length - 1} more</span>
            )}
          </strong>
          <button onClick={() => setOpen(true)}>open</button>
          <button className="icon-btn" onClick={skip} disabled={busy}>
            skip
          </button>
        </div>
      ) : (
        <div>
          <div style={{ marginBottom: '0.5rem' }}>
            <strong>{TYPE_LABEL[top.type]}</strong>
          </div>
          {top.questions.map((q) => (
            <QuestionRow
              key={q.id}
              question={q}
              value={answers[q.id] ?? ''}
              onChange={(v) => setAnswers((prev) => ({ ...prev, [q.id]: v }))}
            />
          ))}
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
            <button className="icon-btn" onClick={() => setOpen(false)}>
              close
            </button>
            <button className="icon-btn" onClick={skip} disabled={busy}>
              skip this
            </button>
            <button onClick={submit} disabled={busy}>
              submit
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

interface QuestionRowProps {
  question: CheckInQuestion;
  value: string;
  onChange: (value: string) => void;
}

function QuestionRow({ question, value, onChange }: QuestionRowProps) {
  if (question.answer === '__readonly__') {
    return (
      <div className="muted" style={{ margin: '0.5rem 0' }}>
        {question.text}
      </div>
    );
  }

  return (
    <div style={{ margin: '0.75rem 0' }}>
      <div style={{ marginBottom: '0.25rem' }}>{question.text}</div>
      {question.type === 'text' && (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={2}
          style={{
            width: '100%',
            padding: '0.4rem',
            font: 'inherit',
            border: '1px solid var(--border)',
            borderRadius: '4px',
          }}
        />
      )}
      {(question.type === 'choice' ||
        question.type === 'mood' ||
        question.type === 'energy') && (
        <div className="energy-buttons">
          {(question.choices ?? []).map((c) => (
            <button
              key={c.value}
              className={value === c.value ? 'active' : ''}
              onClick={() => onChange(c.value)}
              type="button"
            >
              {c.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
