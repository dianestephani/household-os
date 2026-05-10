import 'dotenv/config';
import { connect, disconnect } from '../src/db/connection.js';
import { addTrigger } from '../src/services/triggers.js';
import { Routine } from '../src/db/models/Routine.js';
import { Trigger } from '../src/db/models/Trigger.js';
import { TodayPlan } from '../src/db/models/TodayPlan.js';
import { listEvents } from '../src/utils/google-calendar.js';

const TARGET_DATE = '2026-05-23';

const url = process.env.MONGO_URL ?? 'mongodb://localhost:27017/household_os';
await connect(url);

// 1. Verify against Google Calendar
console.log(`\n=== Verifying calendar for ${TARGET_DATE} ===`);
const events = await listEvents(
  `${TARGET_DATE}T00:00:00.000Z`,
  '2026-05-24T00:00:00.000Z',
);
const housecleaning = events.find((e) =>
  (e.summary ?? '').toLowerCase().includes('housecleaning'),
);
if (housecleaning) {
  console.log(
    `  ✓ Calendar confirms: "${housecleaning.summary}" on ${housecleaning.start?.date ?? housecleaning.start?.dateTime}`,
  );
} else {
  console.log(
    `  ⚠ No "Housecleaning" event found on ${TARGET_DATE}. Other events that day: ${
      events.map((e) => e.summary).join(', ') || '(none)'
    }`,
  );
}

// 2. Show existing cleaner_visit triggers
console.log(`\n=== Existing cleaner_visit triggers ===`);
const existing = await Trigger.find({ type: 'cleaner_visit' })
  .sort({ date: -1 })
  .lean();
if (existing.length === 0) console.log('  (none)');
existing.forEach((t) => console.log(`  ${t.date}  source=${t.source}`));

// 3. Add the new May 23 trigger
console.log(`\n=== Adding cleaner_visit trigger for ${TARGET_DATE} ===`);
// Check if one already exists for this date to avoid dupes
const dupe = existing.find((t) => t.date === TARGET_DATE);
if (dupe) {
  console.log(`  (already exists, skipping insert)`);
} else {
  await addTrigger({
    type: 'cleaner_visit',
    date: TARGET_DATE,
    notes: 'Scheduled housecleaning — anchor for future zone-rotation + regular_cleaning cycles',
  });
  console.log(`  ✓ Trigger inserted`);
}

// 4. Update regular_cleaning.last_done so next_due falls after May 23
console.log(`\n=== Updating regular_cleaning.last_done ===`);
const lastDone = new Date(`${TARGET_DATE}T00:00:00`);
await Routine.updateOne(
  { key: 'regular_cleaning' },
  { $set: { last_done: lastDone } },
);
console.log(`  ✓ regular_cleaning.last_done = ${TARGET_DATE}`);
console.log(
  `  → next_due = ${TARGET_DATE} + 21d = 2026-06-13 (routine's interval — separate from the 6-week cleaner cadence; cleaner visits drive zone-rotation, not this routine)`,
);

// 5. Clear stale TodayPlan so the next morning-gen rebuilds against new state
const cleared = await TodayPlan.deleteMany({});
console.log(
  `\nCleared ${cleared.deletedCount ?? 0} TodayPlan doc(s) — next morning-gen rebuilds against updated state.`,
);

await disconnect();
process.exit(0);
