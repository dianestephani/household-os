import 'dotenv/config';
import { connect, disconnect } from './db/connection.js';
import { Routine } from './db/models/Routine.js';
import inventory from '@household-os/shared/inventory.json' with { type: 'json' };

const url = process.env.MONGO_URL ?? 'mongodb://localhost:27017/household_os';
await connect(url);

const all = [
  ...inventory.rolling_routines.map((r) => ({
    key: r.key,
    name: r.name,
    category: r.category,
    zone: r.zone,
    scheduling: {
      type: 'rolling',
      interval_days: r.interval_days,
      flex_days: r.flex_days,
    },
    estimate_minutes: r.estimate_minutes,
    energy: r.energy,
    skip_if: (r as { skip_if?: string }).skip_if,
    active: true,
  })),
  ...inventory.fixed_routines.map((r) => ({
    key: r.key,
    name: r.name,
    category: 'trash',
    zone: 'whole-house',
    scheduling: {
      type: 'fixed',
      day_of_week: r.day,
      biweekly: (r as { biweekly?: boolean }).biweekly ?? false,
    },
    estimate_minutes: r.estimate_minutes,
    energy: r.energy,
    active: true,
  })),
  ...inventory.as_needed_routines.map((r) => ({
    key: r.key,
    name: r.name,
    category: r.key.startsWith('laundromat') ? 'personal' : 'cleaning',
    zone: 'whole-house',
    scheduling: { type: 'as_needed', trigger: r.trigger },
    estimate_minutes: r.estimate_minutes,
    energy: r.energy,
    active: true,
  })),
  ...inventory.event_driven_routines.map((r) => ({
    key: r.key,
    name: r.name,
    category: r.key.startsWith('airbnb')
      ? 'airbnb'
      : r.key.startsWith('dogsit')
        ? 'dogsit'
        : 'cleaning',
    zone: 'whole-house',
    scheduling: { type: 'event_driven', trigger: r.trigger },
    estimate_minutes: r.estimate_minutes,
    energy: r.energy,
    also_triggers: (r as { also_triggers?: string[] }).also_triggers,
    active: true,
  })),
];

await Routine.deleteMany({});
await Routine.insertMany(all);
console.log(`seeded ${all.length} routines`);

await disconnect();
process.exit(0);
