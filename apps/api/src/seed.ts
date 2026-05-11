import 'dotenv/config';
import { connect, disconnect } from './db/connection.js';
import { Routine } from './db/models/Routine.js';
import inventory from '@household-os/shared/inventory.json' with { type: 'json' };

const url = process.env.MONGO_URL ?? 'mongodb://localhost:27017/household_os';
await connect(url);

interface InventoryFields {
  outsourceable?: boolean;
  outsource_cost_estimate?: number;
  budget_gated?: boolean;
  cost_estimate?: number;
}

function pickOutsource(r: InventoryFields) {
  return {
    outsourceable: r.outsourceable ?? false,
    outsource_cost_estimate: r.outsource_cost_estimate ?? 0,
    budget_gated: r.budget_gated ?? false,
    cost_estimate: r.cost_estimate ?? 0,
  };
}

/**
 * Routines that map to a real-world scheduled appointment (Diane books a
 * time, someone shows up or she shows up somewhere). When seeded with
 * `appointment.enabled = true`, the Routines page surfaces a "📅 Schedule"
 * button per §47 Phase 4 and the hourly reconcile cron starts watching for
 * Google Calendar edits.
 *
 * Durations come from observed appointment lengths; Diane can adjust per-
 * appointment via the schedule modal (overrides default for that occurrence).
 */
const APPOINTMENT_DEFAULTS: Record<string, number> = {
  haircut: 60,
  head_spa: 90,
  brazilian_wax: 30,
  massage: 60,
  nails_apply: 60,
  oil_change: 60,
  car_inspection: 30,
  tire_rotation: 30,
  regular_cleaning: 180, // cleaner visits the house ~3 hours
};

function appointmentField(key: string) {
  const minutes = APPOINTMENT_DEFAULTS[key];
  return minutes
    ? { appointment: { enabled: true, default_duration_minutes: minutes } }
    : {};
}

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
    ...pickOutsource(r),
    ...appointmentField(r.key),
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
    ...pickOutsource(r),
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
    ...pickOutsource(r),
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
    ...pickOutsource(r),
  })),
];

await Routine.deleteMany({});
await Routine.insertMany(all);
console.log(`seeded ${all.length} routines`);

await disconnect();
process.exit(0);
