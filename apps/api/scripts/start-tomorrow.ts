import 'dotenv/config';
import { connect, disconnect } from '../src/db/connection.js';
import { Routine } from '../src/db/models/Routine.js';
import { TodayPlan } from '../src/db/models/TodayPlan.js';

/**
 * "Official launch tomorrow" — backdate every never-completed rolling routine
 * so its first occurrence lands on a deterministic day in [tomorrow,
 * tomorrow + interval_days). Daily routines (interval=1) fire tomorrow.
 * Anything with a real `last_done` is left alone so we never overwrite real
 * completion history.
 *
 * Also clears any TodayPlan in the DB so the next morning-gen run produces a
 * fresh plan grounded in the new last_done values.
 */

function hashOffset(key: string, mod: number): number {
  // FNV-1a-style — small, deterministic, no deps
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % mod;
}

const url = process.env.MONGO_URL ?? 'mongodb://localhost:27017/household_os';
await connect(url);

const startOfTomorrow = new Date();
startOfTomorrow.setHours(0, 0, 0, 0);
startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);

const routines = await Routine.find({
  'scheduling.type': 'rolling',
  active: true,
  $or: [{ last_done: null }, { last_done: { $exists: false } }],
}).lean();

console.log(
  `start-tomorrow: spacing ${routines.length} rolling routines, first due day = ${startOfTomorrow.toISOString().slice(0, 10)}\n`,
);
console.log(
  `${'routine'.padEnd(28)} ${'interval'.padStart(8)}  ${'next_due'.padEnd(10)}`,
);
console.log('-'.repeat(54));

for (const r of routines) {
  const interval = r.scheduling?.interval_days ?? 1;
  const offset = interval === 1 ? 0 : hashOffset(r.key, interval);
  const lastDone = new Date(startOfTomorrow);
  lastDone.setDate(lastDone.getDate() - (interval - offset));

  await Routine.updateOne({ key: r.key }, { $set: { last_done: lastDone } });

  const nextDue = new Date(lastDone);
  nextDue.setDate(nextDue.getDate() + interval);
  console.log(
    `${r.key.padEnd(28)} ${String(interval).padStart(6)}d  ${nextDue.toISOString().slice(0, 10)}`,
  );
}

const cleared = await TodayPlan.deleteMany({});
console.log(
  `\nCleared ${cleared.deletedCount ?? 0} TodayPlan doc(s) — next morning-gen will rebuild from the new last_done values.`,
);

await disconnect();
process.exit(0);
