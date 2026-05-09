import { EnergyLog } from '../db/models/EnergyLog.js';
import { ensureTodayPlan } from './today.js';
import { logActivity } from './activity.js';
import type { EnergyLevel, EnergySuggestion } from '@household-os/shared/types';

const RANK: Record<EnergyLevel, number> = { low: 1, medium: 2, high: 3 };

export async function logEnergy(
  level: EnergyLevel,
  source: 'voice' | 'dashboard' | 'shortcut' | 'cron-default' = 'dashboard',
) {
  await EnergyLog.create({ level, source, ts: new Date() });
  const plan = await ensureTodayPlan();
  if (plan) {
    plan.current_energy = level;
    await plan.save();
  }
  await logActivity('energy_logged', `Energy: ${level}`, {
    actor: source === 'cron-default' ? 'cron' : 'user',
    metadata: { level, source },
  });
  return plan;
}

export async function suggestSwaps(level: EnergyLevel): Promise<EnergySuggestion> {
  const plan = await ensureTodayPlan();
  const newRank = RANK[level];

  const swap_out: EnergySuggestion['suggested_swaps_out'] = [];
  const swap_in: EnergySuggestion['suggested_swaps_in'] = [];

  if (!plan) {
    return {
      level,
      suggested_swaps_in: [],
      suggested_swaps_out: [],
      rationale: 'No plan for today yet.',
    };
  }

  for (const it of plan.items) {
    if (it.status === 'done') continue;
    const itRank = RANK[(it.energy as EnergyLevel) ?? 'low'];
    if (itRank > newRank) {
      swap_out.push({
        routine_key: it.routine_key,
        name: it.name,
        estimate_minutes: it.estimate_minutes ?? 0,
        energy: (it.energy as EnergyLevel) ?? 'low',
      });
    }
  }

  for (const p of plan.swap_pool) {
    const pRank = RANK[(p.energy as EnergyLevel) ?? 'low'];
    if (pRank <= newRank) {
      swap_in.push({
        routine_key: p.routine_key,
        name: p.name,
        estimate_minutes: p.estimate_minutes,
        energy: p.energy as EnergyLevel,
      });
    }
  }

  let rationale = '';
  if (level === 'low') {
    rationale = swap_out.length
      ? "You're low — pulling out high/medium energy items."
      : 'Already low-key. Nothing to swap.';
  } else if (level === 'high' && swap_in.length) {
    rationale = "Energy is high — could pull in some queued items if you want.";
  } else {
    rationale = 'No major changes suggested.';
  }

  return { level, suggested_swaps_in: swap_in, suggested_swaps_out: swap_out, rationale };
}
