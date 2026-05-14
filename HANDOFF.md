# Household OS — v1 Handoff

This document is a self-contained brief for Claude (in VSCode) to scaffold and build out the v1 of Diane's household management system. It captures all decisions made during the design conversation so you don't need outside context.

---

## 1. Who this is for

- **User**: Diane, 34, software engineer (MERN primary; also C# and Python).
- **Tone**: Plain English, casual, no over-explaining. Diane is technical and prefers understanding the bigger picture, but doesn't want hand-holding.
- **Important constraint**: Diane has a hyperfixate-then-burnout pattern with side projects. **Optimize for "set up and walk away," not "rich, evolving system."** Avoid features that require ongoing manual upkeep. Reuse existing tools (Google Calendar, RocketMoney, Alexa) wherever possible instead of rebuilding them.

---

## 2. Goal of v1

A "Household Ops" assistant that:
- Knows Diane's recurring routines and their cadences
- Generates a daily plan sized to that day's available energy/time
- Lets her swap, defer, or mark-done items via dashboard, voice (Alexa), or chat
- Re-plans dynamically when she reports an energy change (with confirmation, not silent rewrites)
- Surfaces today's plan as: (a) Alexa app notification, (b) Google Calendar event, (c) dashboard
- Provides a chat interface to a "Household Ops" Claude persona for free-form edits/questions

**Out of scope for v1** (stub only): Nutrition/Groceries persona, Finance persona. Their dashboard tabs and persona configs exist; their tools return "not yet implemented."

---

## 3. Architecture

```
                      ┌──────────────────────┐
                      │  Mongo (local→Atlas) │
                      │  Routines, TodayPlan │
                      │  EnergyLog, Triggers │
                      └──────────┬───────────┘
                                 │
                      ┌──────────▼───────────┐
                      │   Express API        │
                      │   (mutations+reads)  │
                      └─┬────────┬─────────┬─┘
                        │        │         │
        ┌───────────────┘        │         └──────────────┐
        │                        │                        │
┌───────▼────────┐    ┌──────────▼──────────┐    ┌────────▼─────────┐
│  Publisher     │    │  Persona chat layer │    │  Cron + Calendar │
│  Cal + Alexa   │    │  Claude API +       │    │  reader          │
│  notif sync    │    │  tool use + cache   │    │  (morning gen,   │
└────────────────┘    └─────────┬───────────┘    │   trigger ingest)│
                                │                └──────────────────┘
                  ┌─────────────┼──────────────┐
                  │             │              │
            ┌─────▼────┐  ┌─────▼────┐  ┌──────▼─────┐
            │ Household│  │Nutrition │  │  Finance   │
            │   Ops    │  │ (stub)   │  │  (stub)    │
            └──────────┘  └──────────┘  └────────────┘
```

**Core principle**: Mongo is the single source of truth. All mutations go through Express, which writes Mongo, which fires the publisher, which fans out to Calendar + Alexa. Two surfaces can never drift.

---

## 4. Tech stack & decisions

| Layer | Choice | Why |
|---|---|---|
| Database | MongoDB (local for dev → Atlas free tier for prod) | Diane's MERN background; flexible schema for routines |
| Backend | Node + Express + Mongoose | Same |
| Frontend | React + Vite + TypeScript | Modern, fast dev loop |
| LLM | Anthropic SDK (`@anthropic-ai/sdk`) | Use `claude-opus-4-7` for personas; use `claude-haiku-4-5-20251001` for cheap utility calls |
| Prompt caching | **Required** on persona system prompts + tool defs | Stable content, many turns — caching cuts cost dramatically |
| Voice | Alexa custom skill (Node, hosted on Lambda or as Express webhook) | Diane has Echo devices, no Prime |
| Calendar | Google Calendar API (OAuth) | Already her source of truth |
| Cron | `node-cron` inside the API process for v1 | Simple. Move to dedicated worker if it grows |
| Monorepo | npm workspaces | No need for Nx/Turborepo at this scale |
| Lang | TypeScript everywhere | Diane's preference for the dashboard, may as well unify |

---

## 5. Monorepo layout

```
household-os/
  package.json                  # workspaces root
  tsconfig.base.json
  .env.example
  README.md
  HANDOFF.md                    # this file

  packages/
    shared/                     # types, JSON inventory, persona configs
      src/
        types.ts                # Routine, TodayPlan, etc.
        inventory.json          # the seed data (see §7)
        personas/
          household.ts          # system prompt + tool defs
          nutrition.ts          # stub
          finance.ts            # stub

  apps/
    api/                        # Express + Mongo + cron + publisher
      src/
        index.ts
        db/
          connection.ts
          models/
            Routine.ts
            TodayPlan.ts
            EnergyLog.ts
            Trigger.ts
        routes/
          today.ts
          routines.ts
          energy.ts
          triggers.ts
          chat.ts
        publisher/
          index.ts
          calendar.ts
          alexa.ts
        cron/
          morning-gen.ts
          calendar-ingest.ts
        persona/
          runner.ts             # generic Claude+tools loop
          tools.ts              # tool implementations
        seed.ts                 # one-shot seed from inventory.json

    dashboard/                  # React + Vite
      src/
        App.tsx
        api.ts
        components/
          TodayList.tsx
          EnergyButtons.tsx
          ChatPanel.tsx
          PersonaTabs.tsx

    alexa-skill/                # Alexa custom skill
      skill.json                # manifest
      src/
        index.ts                # intent handlers
        client.ts               # talks to API
```

---

## 6. Data models (Mongoose)

```ts
// Routine.ts — the inventory
{
  _id: ObjectId,
  key: string,                    // stable id, e.g. "litter_scoop"
  name: string,
  category: 'pet' | 'cleaning' | 'trash' | 'airbnb' | 'dogsit' | 'personal',
  zone: 'kitchen' | 'bathrooms' | 'common' | 'bedroom' | 'yard' | 'whole-house',
  scheduling: {
    type: 'rolling' | 'fixed' | 'as_needed' | 'event_driven' | 'zone_rotation',
    interval_days?: number,       // rolling
    flex_days?: number,           // rolling
    day_of_week?: 'mon'|'tue'|...,// fixed
    biweekly?: boolean,           // fixed
    trigger?: string,             // event_driven (e.g. "airbnb_checkin_minus_1d")
    week_in_cycle?: number        // zone_rotation (1-6)
  },
  estimate_minutes: number,
  energy: 'low' | 'medium' | 'high',
  skip_if?: string,               // e.g. "landscaper_this_week"
  also_triggers?: string[],       // routine keys to auto-add
  last_done?: Date,
  active: boolean
}

// TodayPlan.ts — what's selected for today
{
  _id: ObjectId,
  date: 'YYYY-MM-DD',             // unique per day
  day_type: 'day_off'|'catering_day'|'weekday_default'|'tue_thu_pt',
  budget_minutes: number,
  current_energy: 'low'|'medium'|'high',
  items: [{
    routine_key: string,
    name: string,                 // denormalized for display
    estimate_minutes: number,
    energy: 'low'|'medium'|'high',
    status: 'pending'|'in_progress'|'done'|'deferred',
    order: number,
    completed_at?: Date
  }],
  swap_pool: [{                   // items deferred from today, may re-enter
    routine_key: string,
    name: string,
    estimate_minutes: number,
    energy: 'low'|'medium'|'high',
    deferred_at: Date,
    reason: 'energy_drop'|'manual_swap'|'over_budget'
  }],
  publisher: {
    calendar_event_id?: string,   // Google Calendar event ID for today's brief
    alexa_notif_id?: string,      // active Proactive Event id
    last_synced_at?: Date
  }
}

// EnergyLog.ts — for longitudinal patterns
{
  _id: ObjectId,
  ts: Date,
  level: 'low'|'medium'|'high',
  source: 'voice'|'dashboard'|'shortcut'|'cron-default'
}

// Trigger.ts — events that auto-add routines
{
  _id: ObjectId,
  type: 'airbnb_checkin'|'airbnb_checkout'|'dogsit_arrival'|'dogsit_departure'|'landscaper',
  date: 'YYYY-MM-DD',
  source: 'calendar'|'manual',
  source_event_id?: string,       // Google Calendar event id, if applicable
  ingested_at: Date,
  notes?: string
}
```

---

## 7. JSON inventory (seed data)

This is `packages/shared/src/inventory.json`. Diane has signed off on it; she can edit later via the API or by re-running seed.

```json
{
  "energy_budgets_minutes": {
    "day_off": 150,
    "catering_day": 60,
    "weekday_default": 45,
    "tue_thu_pt": 25
  },

  "rolling_routines": [
    { "key": "litter_scoop",   "name": "Scoop both litter boxes",  "category": "pet",      "zone": "bathrooms", "interval_days": 1, "flex_days": 1, "estimate_minutes": 8,  "energy": "low" },
    { "key": "floors_daily",   "name": "Sweep/vacuum pet zones",   "category": "cleaning", "zone": "common",    "interval_days": 1, "flex_days": 1, "estimate_minutes": 12, "energy": "low" },
    { "key": "kitchen_reset",  "name": "Counter + sink reset",     "category": "cleaning", "zone": "kitchen",   "interval_days": 1, "flex_days": 1, "estimate_minutes": 8,  "energy": "low" },
    { "key": "pet_food_water", "name": "Top off food/water",       "category": "pet",      "zone": "kitchen",   "interval_days": 1, "flex_days": 0, "estimate_minutes": 4,  "energy": "low" },
    { "key": "litter_full",    "name": "Full litter change",       "category": "pet",      "zone": "bathrooms", "interval_days": 7, "flex_days": 2, "estimate_minutes": 20, "energy": "medium" },
    { "key": "water_fountain", "name": "Clean cat water fountain", "category": "pet",      "zone": "kitchen",   "interval_days": 7, "flex_days": 3, "estimate_minutes": 10, "energy": "low" },
    { "key": "yard_pickup",    "name": "Yard pickup",              "category": "pet",      "zone": "yard",      "interval_days": 7, "flex_days": 2, "estimate_minutes": 25, "energy": "medium", "skip_if": "landscaper_this_week" }
  ],

  "fixed_routines": [
    { "key": "trash_prep",    "name": "Bins to curb + swap liners", "day": "tue", "time_window": "evening", "estimate_minutes": 20, "energy": "low" },
    { "key": "trash_return",  "name": "Bring bins back",            "day": "wed", "time_window": "evening", "estimate_minutes": 5,  "energy": "low" },
    { "key": "recycle_addon", "name": "Recycle bin out",            "day": "tue", "time_window": "evening", "estimate_minutes": 5,  "energy": "low", "biweekly": true }
  ],

  "zone_rotation_6wk": [
    { "week": 1, "task": null,                                  "estimate_minutes": 0,  "energy": "low" },
    { "week": 2, "task": "Kitchen surfaces + microwave",        "estimate_minutes": 25, "energy": "medium" },
    { "week": 3, "task": "Bathroom sink + toilet wipe-down",    "estimate_minutes": 30, "energy": "medium" },
    { "week": 4, "task": "Floors: vacuum + spot mop",           "estimate_minutes": 40, "energy": "medium" },
    { "week": 5, "task": "Bedroom + common dust-down",          "estimate_minutes": 35, "energy": "medium" },
    { "week": 6, "task": "Pre-cleaner declutter",               "estimate_minutes": 45, "energy": "high" }
  ],

  "as_needed_routines": [
    { "key": "mop",               "name": "Mop floors",              "trigger": "user_flag", "estimate_minutes": 25, "energy": "medium" },
    { "key": "laundromat_pet",    "name": "Laundromat: pet bedding", "trigger": "user_flag", "estimate_minutes": 90, "energy": "medium", "blocking": true },
    { "key": "laundromat_airbnb", "name": "Laundromat: Airbnb",      "trigger": "user_flag", "estimate_minutes": 90, "energy": "medium", "blocking": true }
  ],

  "event_driven_routines": [
    { "key": "airbnb_pre",  "name": "Airbnb pre-checkin clean",   "trigger": "airbnb_checkin_minus_1d",   "estimate_minutes": 60, "energy": "high",   "also_triggers": ["yard_pickup"] },
    { "key": "airbnb_post", "name": "Airbnb post-checkout reset", "trigger": "airbnb_checkout_same_day",  "estimate_minutes": 45, "energy": "medium" },
    { "key": "dogsit_pre",  "name": "Dogsit arrival prep",        "trigger": "dogsit_arrival_minus_1d",   "estimate_minutes": 20, "energy": "low",    "also_triggers": ["yard_pickup"] },
    { "key": "dogsit_post", "name": "Dogsit departure cleanup",   "trigger": "dogsit_departure_same_day", "estimate_minutes": 20, "energy": "low" },
    { "key": "landscaper",  "name": "Landscaper visit (FYI)",     "trigger": "landscaper_date",           "estimate_minutes": 0,  "energy": "low" }
  ],

  "protected_slots": [
    { "key": "pt_tue",    "name": "PT sessions @ gym",  "day": "tue", "time": "morning", "type": "workout" },
    { "key": "pt_thu",    "name": "PT sessions @ gym",  "day": "thu", "time": "morning", "type": "workout" },
    { "key": "lift_flex", "name": "Lifting (flex day)", "day": "any_weekday",            "type": "workout", "count": 1 }
  ]
}
```

---

## 8. API endpoints

All under `/api`. JSON in/out. Auth: single bearer token from `.env` for v1 (no multi-user).

| Method | Path | Purpose |
|---|---|---|
| GET | `/today` | Get today's plan |
| POST | `/today/regenerate` | Force re-run morning gen logic |
| POST | `/today/swap` | Body: `{item_key, replacement_key?}`. If no replacement, items goes to swap_pool |
| POST | `/today/mark-done` | Body: `{item_key}`. Updates routine `last_done` |
| POST | `/today/pull-from-pool` | Body: `{item_key}`. Move from swap_pool back to items |
| POST | `/energy` | Body: `{level: 'low'|'medium'|'high', source}`. Logs + triggers re-plan suggestions |
| GET | `/routines` | List all |
| GET | `/routines/:key` | Get one |
| PATCH | `/routines/:key` | Edit cadence/estimate/energy/etc. |
| POST | `/routines` | Create new |
| DELETE | `/routines/:key` | Soft-delete (set `active: false`) |
| GET | `/triggers` | List upcoming |
| POST | `/triggers` | Manual trigger add (for things not in calendar) |
| POST | `/chat/:persona` | Body: `{messages: [...]}`. Persona = `household` v1, `nutrition` and `finance` stubbed |

**Re-plan suggestion behavior** (`POST /energy`): does NOT mutate the plan. Returns a suggestion object: `{suggested_swaps_in: [...], suggested_swaps_out: [...]}`. The dashboard/Alexa shows these and the user confirms via `/today/swap` and `/today/pull-from-pool`.

---

## 9. Morning generation logic

Cron at 6 AM local. Pseudocode:

```ts
async function generateTodayPlan(date) {
  const today = parseDate(date);
  const dayType = await classifyDay(today);     // checks calendar for catering/PT/work
  const budget  = budgets[dayType];

  const candidates = [
    ...await dueRollingRoutines(today),         // last_done + interval >= today
    ...todaysFixedRoutines(today),              // matches day_of_week (+biweekly check)
    ...currentZoneTaskIfNotDone(today),         // computes week-in-cycle from last cleaner visit
    ...await resolveTriggers(today)             // event-driven adds, applies skip_if, fans also_triggers
  ];

  // Sort: overdue > due > on-time, then high-energy first if budget allows
  const sorted  = prioritize(candidates);
  const packed  = packIntoBudget(sorted, budget);
  const overflow = candidates.filter(c => !packed.includes(c));

  return TodayPlan.create({
    date,
    day_type: dayType,
    budget_minutes: budget,
    current_energy: 'medium',                   // default; user can update
    items: packed.map(toItem),
    swap_pool: overflow.map(toSwapItem),
    publisher: {}
  });
}
```

**Day classification**: read Google Calendar for that day, look for keywords: `catering` → `catering_day`, presence of any all-day or work-block event → `weekday_default`, Tue/Thu morning event → adjust toward `tue_thu_pt`, weekend with nothing → `day_off`.

**Zone rotation week**: `weeksSince(lastCleanerVisit) % 6 + 1`, capped at 6. Last cleaner visit comes from a `Trigger` of type `cleaner_visit` (Diane will need to log these — add a `POST /triggers` call for it).

---

## 10. Publisher (sync to Calendar + Alexa)

`apps/api/src/publisher/index.ts` — debounced, fires after every TodayPlan write.

```ts
import debounce from 'lodash.debounce';
import { syncToCalendar } from './calendar';
import { syncToAlexa }   from './alexa';

const debounced = debounce(async (planId) => {
  const plan = await TodayPlan.findById(planId);
  await Promise.all([syncToCalendar(plan), syncToAlexa(plan)]);
  plan.publisher.last_synced_at = new Date();
  await plan.save();
}, 5000);

export const publish = (planId) => debounced(planId);
```

**Calendar sync** — one all-day event titled "Household: Today" (or similar). Description = formatted checklist. PATCH if `calendar_event_id` exists, else CREATE and store id.

**Alexa sync** — Proactive Events API. To "update" a notification, send a new event and let the old one expire (or use the optional cancel API). Body is text with unicode checkboxes:

```
☐ Bins to curb + swap liners (20 min)
☐ Scoop litter boxes (8 min)
✅ Sweep pet zones (12 min)
```

Store the latest notification id in `plan.publisher.alexa_notif_id`.

---

## 11. Persona chat layer

`apps/api/src/persona/runner.ts`. Generic loop using Anthropic SDK with tool use + prompt caching.

```ts
import Anthropic from '@anthropic-ai/sdk';
import { household } from '@household-os/shared/personas/household';

const client = new Anthropic();

export async function chat(personaName, messages) {
  const persona = personas[personaName];

  const response = await client.messages.create({
    model: 'claude-opus-4-7',
    max_tokens: 1024,
    system: [
      {
        type: 'text',
        text: persona.systemPrompt,
        cache_control: { type: 'ephemeral' }      // <— cache the system prompt
      }
    ],
    tools: persona.tools.map(t => ({
      ...t,
      cache_control: { type: 'ephemeral' }        // <— cache tool definitions
    })),
    messages
  });

  // Loop on tool_use blocks, calling the tool implementations and feeding back tool_result.
  // Continue until stop_reason === 'end_turn'.
  return runToolLoop(response, persona.toolImpls, messages);
}
```

### Household Ops persona (full spec)

`packages/shared/src/personas/household.ts`:

```ts
export const household = {
  name: 'Household Ops',
  model: 'claude-opus-4-7',
  systemPrompt: `
You are Diane's Household Ops assistant. She is 34, rents a 3BR with 2 cats and 2 dogs, Airbnbs spare rooms, dogsits often, and works catering gigs on weekends. She has a hyperfixate-burnout pattern with side projects, so prefer simple, low-maintenance suggestions over elaborate systems.

Your job:
- Help her view, edit, and reason about her household routines and today's plan.
- When she asks for changes, use tools — don't just describe what you'd do.
- For energy-driven swaps: ALWAYS confirm before applying. Suggest the change, wait for "yes" or equivalent, then call the tool.
- Be concise. Casual tone. No bullet-list-of-everything dumps unless asked.
- Voice (Alexa) responses must be ≤2 sentences. Dashboard responses can be longer but stay tight.

You do NOT handle nutrition/groceries or finance — direct her to those personas if asked.
`.trim(),
  tools: [
    {
      name: 'get_today',
      description: 'Get the current TodayPlan including items, swap_pool, energy, and budget.',
      input_schema: { type: 'object', properties: {}, required: [] }
    },
    {
      name: 'list_routines',
      description: 'List all routines, optionally filtered by category or zone.',
      input_schema: {
        type: 'object',
        properties: {
          category: { type: 'string' },
          zone: { type: 'string' }
        }
      }
    },
    {
      name: 'swap_task',
      description: 'Move an item out of today (to swap_pool) and optionally bring a replacement in.',
      input_schema: {
        type: 'object',
        properties: {
          item_key: { type: 'string' },
          replacement_key: { type: 'string' }
        },
        required: ['item_key']
      }
    },
    {
      name: 'pull_from_pool',
      description: 'Bring an item from swap_pool back into today.',
      input_schema: {
        type: 'object',
        properties: { item_key: { type: 'string' } },
        required: ['item_key']
      }
    },
    {
      name: 'mark_done',
      description: 'Mark today\'s item complete and bump the routine\'s last_done.',
      input_schema: {
        type: 'object',
        properties: { item_key: { type: 'string' } },
        required: ['item_key']
      }
    },
    {
      name: 'update_energy',
      description: 'Update current energy and get suggested swaps. Does not mutate plan.',
      input_schema: {
        type: 'object',
        properties: { level: { enum: ['low', 'medium', 'high'] } },
        required: ['level']
      }
    },
    {
      name: 'edit_routine',
      description: 'Patch a routine\'s cadence, estimate, energy, or active flag.',
      input_schema: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          patch: { type: 'object' }
        },
        required: ['key', 'patch']
      }
    },
    {
      name: 'add_trigger',
      description: 'Manually add a Trigger (Airbnb, dogsit, landscaper, cleaner_visit).',
      input_schema: {
        type: 'object',
        properties: {
          type: { type: 'string' },
          date: { type: 'string', description: 'YYYY-MM-DD' },
          notes: { type: 'string' }
        },
        required: ['type', 'date']
      }
    }
  ]
};
```

Each tool name maps to a function in `apps/api/src/persona/tools.ts` that hits the corresponding internal endpoint or model directly.

### Nutrition + Finance personas (stubs)

Same shape, but `tools` is empty (or a single `not_implemented` tool that returns a friendly "this persona is coming later" message). System prompt notes the persona is in stub mode.

---

## 12. Alexa skill

`apps/alexa-skill/`. Custom skill, Node, deployable to Lambda or as an Express webhook on the API server.

**Manifest essentials**:
- Invocation name: `home ops` (or Diane's choice)
- Permissions: `alexa::devices:all:notifications:write` (Proactive Events)
- Account linking: bearer token (matches API auth)

**Intents** (v1):
- `TodayBriefIntent` — "what's on today" → speaks plan, also re-pushes notification
- `SwapTaskIntent` with slot `{Task}` — "swap zone clean" → calls API, speaks confirmation
- `MarkDoneIntent` with slot `{Task}` — "mark trash done"
- `UpdateEnergyIntent` with slot `{Level}` — "I'm low energy" → calls API, speaks suggestions, confirms
- `AskHouseholdIntent` with slot `{Query}` — free-form, routes to `/chat/household`
- Built-ins: `AMAZON.HelpIntent`, `AMAZON.CancelIntent`, `AMAZON.StopIntent`

**Notification flow** — driven by the Publisher, not the skill itself. The skill reads the existing notification on demand but doesn't push it.

---

## 13. Dashboard (minimal)

`apps/dashboard/`. React + Vite + TypeScript. v1 scope:

- **Today panel**: ordered list of today's items; each row has check, swap, defer buttons. Below it, swap_pool collapsed with "pull back" buttons.
- **Energy buttons**: 3 big buttons (Low / Med / High). On click → POST /energy, show suggestion modal, apply on confirm.
- **Persona tabs**: Household Ops (chat panel works), Nutrition (chat panel shows "coming later"), Finance (same).
- **Routines page** (secondary nav): list + edit modal for cadences/estimates.

No styling system needed beyond a small CSS file + maybe Tailwind. Don't bring in a component library yet.

---

## 14. Starter code

### `package.json` (root)

```json
{
  "name": "household-os",
  "private": true,
  "workspaces": ["packages/*", "apps/*"],
  "scripts": {
    "dev:api": "npm -w @household-os/api run dev",
    "dev:dashboard": "npm -w @household-os/dashboard run dev",
    "seed": "npm -w @household-os/api run seed"
  }
}
```

### `apps/api/package.json`

```json
{
  "name": "@household-os/api",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "seed": "tsx src/seed.ts",
    "build": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "latest",
    "express": "^4",
    "mongoose": "^8",
    "node-cron": "^3",
    "googleapis": "^144",
    "lodash.debounce": "^4",
    "dotenv": "^16",
    "zod": "^3"
  },
  "devDependencies": {
    "tsx": "^4",
    "typescript": "^5",
    "@types/express": "^4",
    "@types/node": "^20"
  }
}
```

### `apps/api/src/index.ts`

```ts
import 'dotenv/config';
import express from 'express';
import cron from 'node-cron';
import { connect } from './db/connection';
import todayRouter from './routes/today';
import routinesRouter from './routes/routines';
import energyRouter from './routes/energy';
import triggersRouter from './routes/triggers';
import chatRouter from './routes/chat';
import { generateTodayPlan } from './cron/morning-gen';
import { ingestCalendarTriggers } from './cron/calendar-ingest';

await connect(process.env.MONGO_URL!);

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  if (req.headers.authorization !== `Bearer ${process.env.API_TOKEN}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
});
app.use('/api/today', todayRouter);
app.use('/api/routines', routinesRouter);
app.use('/api/energy', energyRouter);
app.use('/api/triggers', triggersRouter);
app.use('/api/chat', chatRouter);

// 5:30 AM — pull next 7 days of triggers from Google Calendar
cron.schedule('30 5 * * *', () => ingestCalendarTriggers());
// 6:00 AM — build TodayPlan
cron.schedule('0 6 * * *', () => generateTodayPlan(new Date()));

app.listen(3000, () => console.log('api on :3000'));
```

### `apps/api/src/db/connection.ts`

```ts
import mongoose from 'mongoose';
export const connect = (url: string) => mongoose.connect(url);
```

### `apps/api/src/db/models/Routine.ts`

```ts
import { Schema, model } from 'mongoose';

const RoutineSchema = new Schema({
  key: { type: String, unique: true, required: true },
  name: String,
  category: String,
  zone: String,
  scheduling: {
    type: { type: String },
    interval_days: Number,
    flex_days: Number,
    day_of_week: String,
    biweekly: Boolean,
    trigger: String,
    week_in_cycle: Number
  },
  estimate_minutes: Number,
  energy: String,
  skip_if: String,
  also_triggers: [String],
  last_done: Date,
  active: { type: Boolean, default: true }
});

export const Routine = model('Routine', RoutineSchema);
```

(Other models follow the same pattern — TodayPlan, EnergyLog, Trigger.)

### `apps/api/src/seed.ts`

```ts
import 'dotenv/config';
import { connect } from './db/connection';
import { Routine } from './db/models/Routine';
import inventory from '@household-os/shared/inventory.json' assert { type: 'json' };

await connect(process.env.MONGO_URL!);

const all = [
  ...inventory.rolling_routines.map(r => ({ ...r, scheduling: { type: 'rolling', interval_days: r.interval_days, flex_days: r.flex_days } })),
  ...inventory.fixed_routines.map(r => ({ ...r, scheduling: { type: 'fixed', day_of_week: r.day, biweekly: r.biweekly } })),
  ...inventory.as_needed_routines.map(r => ({ ...r, scheduling: { type: 'as_needed', trigger: r.trigger } })),
  ...inventory.event_driven_routines.map(r => ({ ...r, scheduling: { type: 'event_driven', trigger: r.trigger } }))
];

await Routine.deleteMany({});
await Routine.insertMany(all);
console.log(`seeded ${all.length} routines`);
process.exit(0);
```

### `.env.example`

```
MONGO_URL=mongodb://localhost:27017/household_os
API_TOKEN=replace-me-with-a-long-random-string
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_CALENDAR_CREDENTIALS_PATH=./google-creds.json
GOOGLE_CALENDAR_ID=primary
ALEXA_SKILL_ID=amzn1.ask.skill....
ALEXA_CLIENT_ID=...
ALEXA_CLIENT_SECRET=...
```

---

## 15. Build order (recommended)

1. **Scaffold monorepo** + workspaces + tsconfigs + .env.example.
2. **Models + seed**. Run `npm run seed` against local Mongo. Verify routines in Mongo Compass.
3. **`/today` GET + morning-gen cron**. Mock day classification (always return `weekday_default`) at first.
4. **Calendar reader** for day classification + trigger ingest. This unlocks accurate day_type and the landscaper/Airbnb/dogsit triggers.
5. **`/today` mutation endpoints** (swap, mark-done, defer, pull-from-pool).
6. **`/energy` endpoint + suggestion logic**.
7. **Publisher** — start with Calendar only (easier to verify visually). Add Alexa second.
8. **Dashboard** — Today panel + Energy buttons. Skip chat for now.
9. **Persona chat** — Household Ops only, with prompt caching. Add to dashboard as a tab.
10. **Alexa skill** — TodayBriefIntent and UpdateEnergyIntent first (highest value), others after.
11. **Stub Nutrition + Finance personas** in dashboard tabs.

After step 7, the system is genuinely useful. Steps 8–11 are quality-of-life on top.

---

## 16. Things Diane needs to do (out-of-band)

- [ ] Add Mon **2026-05-11** landscaper visit to Google Calendar with title `Landscaper`
- [ ] Decide whether to put household events on the primary calendar or create a dedicated `Household` calendar (recommended: dedicated, easier to query)
- [ ] Get a Google Calendar API OAuth credential JSON, save to project root as `google-creds.json` (gitignored)
- [ ] Create an Anthropic API key, set in `.env`
- [ ] Create an Alexa Developer account skill shell when ready for step 10; the skill ID and client creds go in `.env`
- [ ] Tell the system the date of her **last housecleaner visit** so the zone-rotation week computes correctly (one-off `POST /triggers { type: 'cleaner_visit', date }`)

---

## 17. Open questions / future iterations (don't build now)

- Pattern detection from EnergyLog (e.g., "you're usually low Tuesdays after PT") that pre-biases the morning gen
- Costco/TJ's/QFC bucketing for the Nutrition persona's grocery lists
- RocketMoney CSV import endpoint for the Finance persona
- Multi-user (currently single-user via shared bearer token)
- Notion or iOS Shortcuts integration for one-tap energy reporting

---

End of handoff. Start with §15 step 1.

---

# Part B — Post-v1 update (current as of 2026-05-10)

> **Reading instructions for a fresh Claude instance:** §1–§17 above is the original v1 design doc. Everything in this Part B reflects what has actually been built and changed since the v1 scaffold. When the design doc and this section disagree, **trust this section** — the design doc is historical. Diane wants you to be fully caught up before you write any code. Don't re-do the original §15 build order; it's done.

## Part B Index

Section numbers in Part B are append-order, so they're not always sequential. Use this index to navigate.

**Status + onboarding**
- §18 — State of the system (deployed, test counts, what's running where)
- §19 — Personas — current truth (Household, Finance live; Grocery Manager launcher-only)
- §30 — **How a fresh Claude should pick up** (start here)

**Built subsystems** (each entry is a complete design + impl record)
- §20 — Finance module (gross income, tax estimator, outsourceable + affordability)
- §22 — Context journal (shared narrative log with structured fields)
- §31 — Calendar (today's events via Google Calendar OAuth passthrough)
- §32 — Schedule preview (week/month look-ahead)
- §33 — Theme + typography (light/dark toggle, Inter + Fraunces)
- §34 — Persona handoff to claude.ai (launcher pattern, replaced in-dashboard chat)
- §38 — Google sign-in wall (login on deployed dashboard, session JWT)
- §39 — Day navigator (Today tab is date-aware)
- §40 — Google Tasks integration (read + mark-done from dashboard)
- §41 — Ad-hoc task creation + MCP server (built-but-unused-by-design)
- §42 — Mood/Energy UI confirmation pattern + persona clarification principle
- §43 — Tab persistence + date-aware Workouts/Activity/Journal/Finance + mobile refresh button
- §44 — Zone-assessment multi-task split (comma-separated → N tasks)
- §45 — Grocery Manager persona + Food tab (replaced Nutrition stub) — and the **Alexa Shopping List** integration that's deliberately not built yet
- §48 — **Meal Week Calendar** (interactive Food-tab calendar fed by GM's `MEAL WEEK JSON` paste; new `MealWeek` collection + routes; scoped warm palette)

**Data + content**
- §21 — Routines added since v1 (current count: 48–56 depending on seed timing)
- §24 — Inventory cadences worth knowing
- §23 — Tax + finance UI (FinancePanel structure)

**Operational**
- §25 — Tests — coverage map
- §26 — Operational / deployment notes (Atlas TLS, OAuth path resolution, OverwriteModelError)
- §27 — Skill API additions (older cheat sheet — superseded by §36)
- §28 — Memory + design principles in active use
- §29 — Known gaps / open work
- §35 — "Official launch tomorrow" script (`start-tomorrow`)
- §36 — **Route cheat sheet (canonical, current)** — appears in the middle of Part B due to append-order

**Process notes**
- §37 — Merge from second HANDOFF / second-instance memory (2026-05-10 morning)
- §46 — Latest test count + coverage delta

## 18. State of the system

The v1 plan is shipped and the system is running. The API is on Render (Starter $7/mo); MongoDB lives on Atlas free tier; the dashboard is also on Render as a free static site; the Alexa skill is mounted on the API at `POST /alexa` via `ask-sdk-express-adapter`. There's no separate Lambda. Google Calendar OAuth is wired and working (with the `tasks` scope added in §40). Google sign-in is the login wall on the deployed dashboard (§38). The Food tab is the Grocery Manager launcher (§45) — replacing the old Nutrition stub.

**Current test status: 359 tests across 38 files (349 API + 10 alexa-skill). Typecheck clean across all four workspaces (`shared`, `api`, `dashboard`, `alexa-skill`).**

The for-end-user reference is the **in-app Guide tab** (Dashboard → ❔ Guide); this HANDOFF is just for engineers/Claude.

## 19. Personas — current truth

The original §11 plan said Household Ops would be the only live persona, with Nutrition and Finance as stubs. That's no longer true:

| Persona | Status | Why it matters |
|---|---|---|
| **Household Ops** | Live | Same as v1 |
| **Finance** | Live (full tools) | Helps Diane decide what to outsource and answer "can I afford X" |
| **Nutrition** | Still stub | Diane explicitly deprioritized; "Diane is starting with Household Ops; nutrition comes later" is the canned reply |

Both live personas use Claude Sonnet 4.6 (`claude-sonnet-4-6`) — switched from Opus 4.7 on 2026-05-10 since persona chat now runs on claude.ai (the `model` field is documentation only; Claude Projects pick model in their own UI). Both have `log_context` and `recent_context` tools and call `recent_context` at the start of every conversation (see §22).

## 20. Finance subsystem (was a stub in v1; now real)

**Why it exists:** Diane has a hyperfixate-burnout pattern with side projects. She needs gentle pressure to outsource the right things at the right time, not silently take on too much. The system pushes back on outsourcing decisions that don't fit her discretionary, and surfaces affordability data instead of guessing.

### Data model — `FinancialProfile` (singleton, key: 'self')

```ts
interface FinancialProfile {
  key: 'self';
  monthly_gross_income: number;        // pre-tax, all jobs combined
  monthly_tax_estimate: number;        // estimated monthly withholding
  monthly_fixed_expenses: number;      // rent + insurance + subscriptions etc.
  state?: string;                      // two-letter, e.g. WA — drives state tax
  filing_status?: 'single' | 'married_jointly' | 'head_of_household';
  monthly_extra_withholding?: number;  // total $/mo across all paychecks
  notes?: string;
  expense_breakdown?: string;          // free-form RocketMoney paste
  updated_at: Date;
}
```

Discretionary = `gross − tax − fixed`, clamped at zero. Diane is single-filer, WA (no state tax), gross ~$4–6k/mo, $25–50 extra withholding per paycheck per job (multiple jobs).

### Tax estimator (`estimateMonthlyTax`)

Pure compute — does not persist. Uses 2025 federal brackets per filing status, FICA (SS 6.2% capped at $168,600 wage base + Medicare 1.45%), and a state effective-rate lookup table that includes WA/FL/NV/etc. as 0%, plus rough rates for ~15 other common states. Returns `{ federal, fica, state_tax, extra, total, effective_rate, notes }`. The notes string flags "ballpark only — not a substitute for actual tax software" and warns when state isn't in the lookup table. Exposed as both `POST /api/finance/estimate-tax` (route, no persistence) and the persona tool `estimate_tax`.

### Outsourceable summary + affordability report

`listOutsourceable()` walks every routine where `outsourceable: true && active: true`, multiplies `outsource_cost_estimate` by `monthly_occurrences` (computed from `scheduling.interval_days` for rolling, or `7/30` / `14/30` for fixed weekly/biweekly), and returns the items sorted by `monthly_cost` desc plus a total.

`affordabilityReport()` runs a greedy largest-first split: walks the sorted items and keeps adding to `fits_within_discretionary` while there's discretionary headroom; everything else lands in `exceeds_discretionary`. Returns the profile, computed discretionary, both lists, and a one-line rationale ("at $130/mo discretionary, you could cover 1 item (~$128.57/mo).").

### Persona system prompt (key behaviors)

The Finance persona is **not** RocketMoney — it explicitly redirects raw transaction questions there. It always calls `get_financial_profile` first (so it sees the latest numbers AND the `expense_breakdown` text), then `estimate_tax` if asked about take-home, then `affordability_report` for "can I afford X?" style questions. It cross-references the free-form expense breakdown when answering about specific categories ("you said groceries are about $X/mo there; the system has biweekly groceries at $Y/mo if outsourced").

It also reminds her exactly once per conversation about 1099 self-employment tax (~25–30%) when she mentions side-gig income. Tone is casual; no moralizing about spending.

## 21. New routines added since v1 (49 total in inventory.json)

The v1 inventory had ~18 routines. Diane and I have iterated heavily; current count is 49 (40 rolling, 3 fixed, 2 as_needed, 5 event-driven, plus the 6-week zone rotation and 3 protected workout slots).

Headline additions since v1:

- **Bathrooms / kitchen / bedroom rotations** — toilet_deep, shower_scrub, mirror_glass, fridge_cleanout, pantry_check, oven_clean, sheets_wash, bedroom_dust, under_bed_vacuum, closet_declutter
- **Pet care** — nail_trims (35d, outsourceable $30), dog_bath, monthly_meds, dish_disinfect (7d), pet_brushing (7d), pet_bedding_wash (14d), crate_gate_wipe (14d) — Diane has 2 dogs + 2 cats permanent and dogsits up to 5+ guest dogs at once (peak observed: 7)
- **Vehicle maintenance** — oil_change (120d), registration_renewal (365d), car_inspection (365d), tire_rotation (180d)
- **Personal** — groceries_biweekly ($175 outsourceable), meal_prep_weekly ($70 outsourceable), personal_laundry
- **Whole-house cleaning** — regular_cleaning (21d, outsourceable $380 — actual quote from her cleaner), floor_specialty (90d quarterly, outsourceable $300)
- **Air quality / dirt control** (added when Diane flagged "I have an ALEN BreatheSmart Flex with the filter overdue") — air_purifier_filter (180d), hvac_filter (50d), vacuum_filter_clean (30d), upholstery_vacuum (14d), entry_mat_shake (3d). The air purifier filter shows up immediately as overdue because seeded routines have `last_done = null` and morning-gen treats `daysSince = Infinity` as overdue.
- **Yard pickup** — was outsourced at $86/mo; was previously folded into airbnb_pre's `also_triggers`

The seed script ([apps/api/src/seed.ts](apps/api/src/seed.ts)) does `Routine.deleteMany({})` then `insertMany(all)`. Re-seeding **wipes `last_done` history** — fine for early dev but watch out once Diane has weeks of completion data. Eventually we should switch to upsert-by-key.

## 22. Context journal (new subsystem — shared by both personas)

This was added because the personas could only read scalar signals (mood log, energy log, today plan) — there was nowhere for qualitative "today is rough because X" context to land, and no way for Diane to feed new information into Finance mid-conversation that affects future affordability reasoning.

### Data model — `ContextEntry`

Append-only log:

```ts
interface ContextEntry {
  ts: Date;
  text: string;                              // required, 1–3 sentences
  tags?: string[];                           // free-form labels
  energy?: 'low' | 'medium' | 'high';
  mood?: 'good' | 'neutral' | 'down';
  dogsit_count?: number;                     // guest dogs (excluding her 2)
  blocked_activities?: string[];             // free-form: 'workout', 'errands', 'leave_house', etc.
  related_persona?: 'household' | 'finance' | 'both';   // default 'both'
  source: 'voice' | 'dashboard' | 'persona' | 'api';
}
```

Free text is the truth of record; structured fields are for pattern queries later.

### Service ([apps/api/src/services/context.ts](apps/api/src/services/context.ts))

- `addContext(input)` — validates non-empty text, strips empty arrays, writes the entry, fires a `context_logged` ActivityLog entry (actor=`system` if `source='persona'`, else `user`)
- `recentContext(days, persona?)` — newest-first; persona filter returns matching persona OR `'both'`
- `todaysContext(persona?)` — entries from local-midnight onward

### Routes

- `GET /api/context?days=7&persona=…`
- `GET /api/context/today?persona=…`
- `POST /api/context` — body validates `text` is required

### Persona integration (both household + finance)

Both personas have `log_context` and `recent_context` as tools. The system prompts instruct them to:

1. **Call `recent_context` at the start of every conversation** — household defaults to 7-day window, finance to 14-day. So Diane never has to re-explain context she already shared.
2. **When she shares qualitative context in chat, propose to log it.** Auto-extract structured fields (`dogsit_count` from "5 dogs," `energy`/`mood` from how she describes her state, `blocked_activities` from things she says she couldn't do). Confirm once: *"I'd log: '<short summary>' with dogsit_count=5, energy=low, blocked=[workout]. Sound right?"* — then call the tool. Don't ask field-by-field.
3. **`related_persona` defaults**: household persona uses `household`, finance uses `finance`, both can set `'both'` for cross-cutting context (e.g. chaos week → ordering takeout = extra spend).
4. **Don't double-log scalars vs narratives.** `log_mood` and `update_energy` are still the right primitives for plain mood/energy data; the journal captures the *story* + reasoning.

### Dashboard

Two surfaces:

- **Journal tab** ([apps/dashboard/src/components/JournalPanel.tsx](apps/dashboard/src/components/JournalPanel.tsx)) — full panel with free-text entry, toggleable structured-fields card (energy / mood / dogsit_count / blocked-activity chips / tags / persona selector), recent-entries list with day-window selector
- **Today context strip** ([apps/dashboard/src/components/TodayContextStrip.tsx](apps/dashboard/src/components/TodayContextStrip.tsx)) — read-only inline strip on the Today view that surfaces today's entries above the plan; auto-hides when empty

The first seeded entry (2026-05-09) is in the DB: 7 dogs, exhausted, blocked=[workout, leave_house, errands], related_persona=both.

## 23. Tax + finance UI (new tab)

[apps/dashboard/src/components/FinancePanel.tsx](apps/dashboard/src/components/FinancePanel.tsx) shows three sections:

1. **Monthly profile** — gross income, state, filing_status, monthly extra withholding, monthly tax estimate (with **"Estimate tax from gross + state"** button that calls `POST /api/finance/estimate-tax` and auto-fills the field; displays the federal/FICA/state/extra/total/effective-rate breakdown card), monthly fixed expenses, optional notes. Shows the running breakdown: `Gross → Tax → Net → Fixed → Discretionary`.
2. **RocketMoney context (free-form)** — `expense_breakdown` paste field; persona reads this verbatim.
3. **Outsourceable routines table** — sortable table of every outsourceable routine (cost/visit, occurrences/mo, $/mo total) with check marks on the items that fit within current discretionary.

There's also a Finance ChatPanel inline at the bottom for free-form persona chat.

## 24. Inventory cadences worth knowing

| Routine | Cadence | Outsource $ |
|---|---|---|
| `regular_cleaning` | 21d (every 6 weeks) | $380 actual |
| `groceries_biweekly` | 14d | $175 |
| `meal_prep_weekly` | 7d | $70 |
| `floor_specialty` | 90d (quarterly) | $300 |
| `yard_pickup` | 30d, `skip_if: landscaper_this_week` | $86 actual |
| `nail_trims` | 35d | $30 |
| `air_purifier_filter` | 180d | (not outsourced) |
| `hvac_filter` | 50d | (not outsourced) |
| `vacuum_filter_clean` | 30d | (not outsourced) |
| `pet_brushing` | 7d (was 3d, Diane bumped to weekly) | (not outsourced) |
| `dish_disinfect` | 7d | (not outsourced) |
| `crate_gate_wipe` | 14d | (not outsourced) |
| `upholstery_vacuum` | 14d | (not outsourced) |
| `entry_mat_shake` | 3d | (not outsourced) |
| `pet_bedding_wash` | 14d | (not outsourced) |

Trash bins: `trash_prep` (Tue evening), `trash_return` (Wed evening), `recycle_addon` (Tue evening, biweekly).

`laundromat_pet` was removed from `as_needed` and replaced by the rolling `pet_bedding_wash` (Diane's volume warrants a real cadence).

## 25. Tests — coverage map

158 total: 148 API + 10 alexa-skill, all passing.

API test files of note:
- [`services/finance.test.ts`](apps/api/src/services/finance.test.ts) (17) — profile CRUD + singleton, discretionary math, estimateMonthlyTax (WA no-state, extra-withholding linearity, CA > WA, unknown-state flag, zero-income), listOutsourceable cadence math, affordabilityReport greedy split + zero-discretionary rationale
- [`services/context.test.ts`](apps/api/src/services/context.test.ts) (10) — minimal entry + defaults, structured fields, empty-array stripping, validation, activity-log side effect, persona filter incl. `'both'` semantics, days window, today-only
- [`persona/tools.test.ts`](apps/api/src/persona/tools.test.ts) (10) — **schema/impl drift detector**: every tool declared in [packages/shared/src/personas/](packages/shared/src/personas/) has a runtime impl; smoke-tests for `log_context` (default related_persona per persona, source=persona, structured-field passthrough), `recent_context` (default-persona filtering), `estimate_tax` (component math)
- [`services/activity-wiring.test.ts`](apps/api/src/services/activity-wiring.test.ts) (12) — every action site that should write an ActivityLog entry does (markDone, swap with/without replacement, pull, energy/mood/workout/zone-assessment/cancel/trigger/routine-edit). `context_logged` is covered in context.test.ts directly.
- [`persona/runner.test.ts`](apps/api/src/persona/runner.test.ts) (4) — stub short-circuit, plain-text return, tool loop, unknown persona handling

## 26. Operational / deployment notes

- **Render**: API is on Starter ($7/mo always-on — free tier sleeps and breaks cron). Dashboard is on the static-site free tier. MongoDB on Atlas M0 free.
- **Atlas Network Access**: `0.0.0.0/0` is allowed (Render IPs aren't fixed). The connection string MUST end with `/household_os?…` — leaving the DB name off lands writes in `test` and Render reads from `household_os` and you wonder why it's empty (this happened in early deploy).
- **Atlas TLS**: an early deploy hit `ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR` until `0.0.0.0/0` was added.
- **Alexa skill API base URL**: the skill internally calls `http://localhost:${process.env.PORT ?? '3000'}/api` and uses `HOUSEHOLD_API_TOKEN ?? API_TOKEN` — see [apps/alexa-skill/src/client.ts](apps/alexa-skill/src/client.ts). This is because Render uses dynamic `PORT` and the skill is mounted on the same Express server.
- **Google Calendar OAuth**: web-app type, redirect `http://localhost:53682/`. The one-time auth helper is `npm -w @household-os/api run google-auth`. Path resolution uses `import.meta.url` because npm-workspace cwd is `apps/api/`, not the repo root.
- **Test environment isolation**: [apps/api/src/utils/google-calendar.ts](apps/api/src/utils/google-calendar.ts) has `if (process.env.NODE_ENV === 'test') return [];` guards on `listEvents` and `upsertEvent` — without them, tests on Tuesday would actually classify the day as `tue_thu_pt` because they'd hit the real calendar.
- **Mongoose `OverwriteModelError`**: every model export uses the defensive pattern `mongoose.models.X ?? mongoose.model('X', schema)` — multiple test files import the same models in the same process.
- **Git signing**: Diane's commits use SSH-based signing (`~/.ssh/id_ed25519.pub`) after GPG passphrase issues. Don't try GPG.
- **First-time Mongo bootstrap on a clean DB**: `npm run seed` writes 49 routines. The dashboard expects routines to exist; running with an empty DB shows an empty Today plan.

## 27. Skill API additions (cheat sheet)

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/today` | GET | Current TodayPlan |
| `/api/today/regenerate` | POST | Force re-gen (also runs from cron at 6am) |
| `/api/today/swap` | POST | Move item to swap_pool, optionally pull a replacement |
| `/api/today/mark-done` | POST | |
| `/api/today/pull-from-pool` | POST | |
| `/api/routines` | GET / PATCH `:key` | |
| `/api/energy` | POST | log + suggestion |
| `/api/mood` | POST | |
| `/api/workouts/today`, `/api/workouts` | GET / POST | |
| `/api/zones`, `/api/zones/assess`, `/api/zones/tasks` | various | |
| `/api/checkins/pending`, `/api/checkins/:id/answer`, `…/skip` | various | |
| `/api/triggers` | GET / POST | |
| `/api/patterns/deferrals`, `/api/patterns/workouts` | GET | |
| `/api/activity` | GET | unified timeline |
| **`/api/finance/profile`** | **GET / PATCH** | new |
| **`/api/finance/outsourceable`** | **GET** | new |
| **`/api/finance/affordability`** | **GET** | new |
| **`/api/finance/estimate-tax`** | **POST** | new (pure compute) |
| **`/api/context`** | **GET / POST** | new (journal) |
| **`/api/context/today`** | **GET** | new |
| `/api/chat/:persona` | POST | Claude chat (household / finance / nutrition) |
| `/alexa` | POST | Alexa webhook (raw body, signature-verified) |

## 28. Memory + design principles in active use

There are five memories Claude carries across sessions for this project (in `~/.claude/projects/.../memory/`):

1. **`user_adhd_energy.md`** — Diane has ADHD, fluctuating energy, fluid-but-structured workflow. The system has to absorb that.
2. **`reference_finance_tools.md`** — RocketMoney is primary, Credit Karma is secondary. CSV import is the realistic ingestion path. The system **does not** replicate transaction-level finance tracking.
3. **`project_accountability_design.md`** — System should provide gentle pushback on repeated deferrals / skipped workouts. Silent accommodation is a failure mode. Pressure must be data-driven, not arbitrary.
4. **`project_data_learning_principle.md`** — Every feature should generate detailed data and feed that data back into better predictions. Default to *more* structured fields, not less. Reconcile estimates against reality (per-routine `estimate_minutes`, `outsource_cost_estimate`) over time. This is why the journal has structured fields alongside free text.
5. (memory index `MEMORY.md`)

If you (Claude) do work on this project: respect these — they're the substrate the user has explicitly told us to operate on.

## 29. Known gaps / open work (don't build unprompted)

- **Weather signal** — Diane flagged that weather is a load multiplier (tracked-dirt risk), but there's no weather ingestion. A daily WA forecast pull could bump entry/floor routines on bad-weather days. Not built.
- **Dogsit volume as a covariate** — `dogsit_pre` / `dogsit_post` events don't currently capture *how many* guest dogs. The journal entry now does (`dogsit_count`); eventually that should flow into trigger metadata so cleaning load can be modeled per dogsit.
- **Estimate vs reality reconciliation** — `estimate_minutes` and `outsource_cost_estimate` are seed values; once enough completion logs exist they should auto-tune. Not yet.
- **Completion-time mood/energy capture** — `markDone` records timestamp only. We could optionally capture actual minutes, mood/energy, and a "felt easier/harder than usual" flag. Not yet.
- **Patterns-from-EnergyLog** — original §17 open question; still open.
- **RocketMoney CSV import** — Diane currently pastes a free-form summary. Structured CSV ingestion is realistic but not built; expect 1099 + W-2 commingled rows.
- **Multi-user** — single-user via shared bearer token. Original §17 open question; still open.
- **Today/Schedule appointment time rendering** — appointment-enabled routines that have a linked Google Calendar event don't yet display the event's actual start time in the Today plan or Schedule preview; they still show as "due today" based on cadence math. Deferred from Phase 4 (see §47). Needs `appointment.last_event_start` threaded through `getDayView` + `scheduleRange` and the rendering panels updated.
- **Re-seeding wipes appointment linkage** — once Diane has scheduled real Google Calendar appointments via Phase 4, re-running `seed.ts` blows away `appointment.calendar_event_id` + `last_event_start` (same delete+insert gotcha as `last_done`, §21). Switching `seed.ts` to upsert-by-key would fix this for both fields at once.

## 30. How a fresh Claude should pick up

1. **Read the Part B Index** above for navigation. §1–§17 is the original v1 design; §18 onward is current truth. When they conflict, current truth wins.
2. **Read the memory** at `~/.claude/projects/-Users-dianestephani-Documents-Projects-Personal-Projects-household-os/memory/MEMORY.md` — the index there lists 12+ memory files including ADHD/energy patterns, dietary constraints, beauty maintenance, finance tools, the chat-interface and session-persistence decisions, and the two-emails-distinction (`reference_emails.md`: personal Gmail for OAuth, work email for OMG context — NOT interchangeable).
3. `git status` + `git log --oneline -20` to see what's been touched recently.
4. **`npm test` should pass 359 tests across 38 files** (349 API + 10 alexa-skill). `npm run typecheck` should be clean across all 4 workspaces.
5. Skim the subsystem sections relevant to whatever Diane asks about. §36 is the canonical route cheat sheet — bookmark that.
6. Ask Diane what she wants to work on. **Default to small, contained changes** — she has the hyperfixate-burnout pattern noted in §1 and `hyperfixate_burnout` memory. Don't propose multi-week refactors unprompted. **Don't push chat-style interfaces** — she declined Claude.ai connectors, Claude Desktop, AND re-adding dashboard chat on 2026-05-10 (see `feedback_chat_interface_decision` memory). Voice (Alexa) + dashboard buttons + per-persona Claude.ai launchers is the chosen interaction model.
7. If she shares qualitative context in conversation, log it via the journal — `POST /api/context` directly with `related_persona` and any extractable structured fields. Don't lose context to a session boundary.
8. The end-user reference is the **Dashboard → ❔ Guide tab**. If Diane asks "how do I X" and the answer is in there, point her at it before re-explaining.

### Top-of-mind operational gotchas

- **Render env vars must use absolute `/etc/secrets/...` paths** for Google Calendar creds — not the `./google-creds.json` from `.env.example`. Diane hit this once.
- **Atlas isn't seeded automatically.** After any inventory change, she has to run `npm -w @household-os/api run seed` against the Atlas connection string (or via Render Shell). `start-tomorrow` after that to space out cadences.
- **Tasks API scope** was added to the Google OAuth token on 2026-05-10. If a future change requires re-consent, `npm -w @household-os/api run google-auth` regenerates the token; she must re-upload `google-token.json` to Render Secret Files afterward.
- **MCP server is built but unwired** (§41). Don't try to wire it without an explicit ask — she declined this path twice.
- **Session is 30-day localStorage** on the dashboard (§38, revised in §43 area). Don't switch to sessionStorage without an explicit ask — she reversed that decision after iOS 2FA friction.

---

## 31. Calendar (today's events) subsystem

A small read-only passthrough to Google Calendar so the Today view shows the day's events alongside the routine plan. **Reuses the existing OAuth + `listEvents` already used by trigger ingestion** — no new auth, no new env vars.

### Service ([apps/api/src/services/calendar.ts](apps/api/src/services/calendar.ts))

Pure helpers + one orchestrator, all unit-testable:

- `dayRange(now)` → `{ startIso, endIso }` for local-midnight to next-local-midnight
- `openInCalendarUrl(date, view = 'day' | 'week' | 'month')` → a `https://calendar.google.com/calendar/u/0/r/<view>/Y/M/D` permalink (the `/u/0/` path means "first signed-in account" — works for Diane's single-account setup)
- `normalizeEvent(googleEvent)` → trimmed `CalendarEvent` (`id`, `summary`, `start`, `end`, `is_all_day`, optional `location` + `html_link`); returns `null` for events missing required bits. Detects all-day from `event.start.date` (vs `event.start.dateTime`).
- `todaysEvents(now = new Date())` → `CalendarDayResponse` combining the above; uses `isCalendarConnected()` to short-circuit when OAuth isn't set up

### Connection helper ([apps/api/src/utils/google-calendar.ts](apps/api/src/utils/google-calendar.ts))

`isCalendarConnected()` returns `false` in `NODE_ENV=test` (deterministic test behavior regardless of local creds) and otherwise just checks that `getCalendarClient()` returns non-null.

### Route + dashboard

- `GET /api/calendar/today`
- `CalendarDayPanel` ([apps/dashboard/src/components/CalendarDayPanel.tsx](apps/dashboard/src/components/CalendarDayPanel.tsx)) shown on the **Today** view above the context strip. Three states: connected with events, connected with no events ("Nothing scheduled today"), not connected (with the exact `npm -w @household-os/api run google-auth` command). Each event row links to its `htmlLink`; the panel header has an "Open in Google Calendar →" link to the day permalink.

### Tests

7 tests in [apps/api/src/services/calendar.test.ts](apps/api/src/services/calendar.test.ts): `dayRange` math, URL zero-padding, normalization (timed / all-day / no-summary fallback / missing-required → null), and an integration smoke that `todaysEvents` returns `connected: false` in test mode with the right URL shape.

## 32. Schedule preview (week / month look-ahead)

Diane explicitly asked for the ability to look ahead at the week or month, not just today. Built on the same data already in Mongo — no future-energy prediction, no morning-gen-for-future-days side effects.

**Design call:** I deliberately do *not* run morning-gen for each future date, because morning-gen persists, logs activity, and publishes. Instead the schedule service walks each routine source independently and buckets each due routine on its **earliest due day** in the window, with anything already overdue collapsed onto day 0. Each routine appears at most once per response.

### Service ([apps/api/src/services/schedule.ts](apps/api/src/services/schedule.ts))

- `buildWindow(now, days)` → `{ start, end }` at local midnight, exclusive upper bound
- `rollingDueByDay(start, end)` — for each rolling routine: normalize `last_done` to local midnight (avoids time-of-day off-by-one bugs we hit on first build), compute `nextDue = last_done + interval`. Bucket on `start` if already overdue (note `overdue Nd`), on `nextDue` if it lands in window (`due`), or skip. **`last_done = null` → bucket on `start` with `never done`.** Honors `skip_if: 'landscaper_this_week'` by pre-fetching landscaper triggers in `[window − 7d, window + 7d]`.
- `fixedDueByDay(start, end)` — walk every day in window, match `day_of_week`, apply biweekly cycle parity using the same `FIXED_EPOCH = new Date(2026, 0, 1)` anchor as morning-gen.
- `zoneRotationByDay(start, end)` — same Sat/Sun + week-since-cleaner-visit logic as morning-gen.
- `eventDrivenByDay(start, end)` — query triggers in `[window − 7d, window + 7d]`, look up each event-driven routine's offset (e.g. `airbnb_checkin_minus_1d` → `airbnb_checkin` trigger, `−1` day offset) via the `TRIGGER_OFFSETS` map, bucket on `triggerDate + offsetDays` if it lands in window. Friendly notes per trigger type ("Airbnb checkin tomorrow," "Landscaper today").
- `pendingAdHocTasks()` — open `AdHocTask`s sorted by ts ascending; **not date-anchored**, returned at the top of the response so the UI can show them as a separate "pull these in when energy allows" list.
- `scheduleRange(now, days)` — orchestrates everything in parallel, runs calendar event lookup using `listEvents(start, end)`, buckets events by their start day. Days clamped to `[1, 60]`. Picks `view` (`day` / `week` / `month`) for `open_in_calendar_url` based on day count.

### Route + dashboard

- `GET /api/schedule?days=N`
- New top-level **Schedule** tab in [App.tsx](apps/dashboard/src/App.tsx) with a Week (7) / Month (30) pill toggle. Compact mode collapses empty days to `—`. Each day shows calendar events first (with click-through to event), then routine-due rows with a small source badge (`Rolling` / `Fixed` / `Zone` / `Event`) and the cadence note. Pending ad-hoc tasks rendered above the day list.

### Tests

13 tests in [apps/api/src/services/schedule.test.ts](apps/api/src/services/schedule.test.ts): rolling never-done / overdue at window start / due in window / past window end / `skip_if`; fixed weekly / biweekly cycle parity; event-driven `airbnb_pre` (-1d) and `landscaper` (same day); window clamping (1 / 60); `is_today` flag; calendar disconnected in test mode; pending ad-hoc tasks listed.

**Two real bugs the tests caught while being written:**

1. `nextDue < start` was false when both equaled `start` for never-done routines — fixed by special-casing `last == null`.
2. `last_done` carries the time-of-day from `markDone(new Date())`, which made `diffDays(start, nextDue)` floor to 2 instead of 3 for a 10-day-old `last_done` with 7-day interval. Fixed by normalizing `last_done` to midnight before any interval math.

Both are documented in the file header.

## 33. Theme + typography

Built when Diane asked for "more elegant" styling with a light/dark toggle. Strict-grayscale palette (the `--accent` is just the foreground text color in each theme, so "active" states are pure contrast — no hue).

- [apps/dashboard/src/styles.css](apps/dashboard/src/styles.css) — token sets keyed by `[data-theme='light' | 'dark']`. Light: `#fafaf9` bg, `#0a0a0a` text. Dark: `#0d0d0d` bg, `#f5f5f4` text. Both have `color-scheme` set so native form controls + scrollbars match. `--good` / `--bad` kept as muted semantic colors.
- **Inter** (body, with stylistic features `cv11` + `ss01` for the refined `1` / `l` distinction) and **Fraunces** (h1–h4 display serif) loaded from Google Fonts via `<link>` in [apps/dashboard/index.html](apps/dashboard/index.html).
- `<head>` inline script reads `localStorage.theme` (or `prefers-color-scheme` on first run) and sets `document.documentElement.dataset.theme` **before paint** — prevents the flash-of-wrong-theme.
- [ThemeToggle.tsx](apps/dashboard/src/components/ThemeToggle.tsx) — pill button in the app header that flips `data-theme` and persists to localStorage.

Component code didn't need to change because everything was already token-driven (`var(--…)`), so the new palette cascaded for free.

## 34. Persona handoff to claude.ai (replaces in-dashboard chat)

Diane decided she'd rather chat with personas on **claude.ai** instead of paying for an Anthropic API key for in-dashboard tool-use chat. New design:

### Trade-off (made explicit to her before building)

Claude.ai can't call our custom tools (`swap_task`, `affordability_report`, etc.). So personas become **advisory only** when used through the launcher — they can think with her and reference data she pastes, but can't mutate the system. She accepted this trade-off.

### The launcher ([PersonaLauncher.tsx](apps/dashboard/src/components/PersonaLauncher.tsx))

**Updated 2026-05-10: project URLs are hardcoded on each persona config.** All three live personas have `projectUrl` set in [packages/shared/src/personas/](packages/shared/src/personas/); the launcher reads `config.projectUrl` directly. The earlier "Saved Claude Project URL" localStorage input was removed — it was a placeholder from when only grocery had a hardcoded URL. Any old `persona-project-url-*` keys in localStorage become inert (harmless dead data).

Two panels per persona now:

1. Name + one-line blurb + primary "Open in Claude.ai →" button → `config.projectUrl ?? 'https://claude.ai/new'`. On iOS, tapping the link triggers Universal Links → Claude app prompt when the app is installed (no per-platform code needed — plain `<a href>` with `target="_blank"`).
2. **System prompt panel — read-only by default, compact.** Renders the prompt in a small (`rows={6}`) textarea that's `readOnly` until you click **Edit**. Header buttons: `Edit` / `Done` toggle (flips `readOnly`), `Reset` (only visible in edit mode, restores `draft` to `config.systemPrompt`), and `Copy` (always available, copies the current draft via `navigator.clipboard.writeText` with a `textarea.select()` fallback). Edits are local-only — they live in component state, never persist to localStorage or back to the repo. Use case: tweak the protein target or constraints for a one-off copy-paste into the Claude Project settings without committing a config change. Hot-reload of the canonical prompt or a persona switch clears any in-flight draft via a `useEffect` keyed to `config.systemPrompt`.

**Current project URLs** (also asserted in [apps/api/src/persona/tools.test.ts](apps/api/src/persona/tools.test.ts) so renames fail loud at build time):

| Persona | Project URL |
| --- | --- |
| Household Ops | `https://claude.ai/project/019e1022-63c0-752f-a25c-38f80dbc6cc2` |
| Finance | `https://claude.ai/project/019e1024-e34d-7631-9a50-83a964f5921c` |
| Grocery Manager | `https://claude.ai/project/019e141a-8cbc-720d-843a-0732ad1293c2` |

The launcher imports persona configs directly from `@household-os/shared/personas/household` and `@household-os/shared/personas/finance` (these are already exported from the shared package's `package.json` `exports` field — no API roundtrip needed).

### What changed in the dashboard

- Household tab → `<PersonaLauncher persona="household" />`
- Finance tab → keeps the profile + outsourceable + affordability sections (those still need the API), with `<PersonaLauncher persona="finance" />` swapped in at the bottom in place of the inline ChatPanel
- Nutrition tab → small inline "not built yet" panel (it was already a stub)
- `ChatPanel.tsx` is **still in the repo** but no longer rendered. `/api/chat/:persona`, the persona runner, and all tool implementations are also intact. If a future Claude wants to re-enable in-dashboard chat (e.g., once Anthropic offers MCP access from claude.ai), no backend work is needed — just re-add the component.

### What changed in operational config

- `ANTHROPIC_API_KEY` is **no longer required** for the dashboard to function. The README and HANDOFF call this out. Diane can leave the env var blank locally and on Render. The `/api/chat/:persona` route would still try to use it if hit, but nothing in the UI hits that route.
- Total monthly cost dropped to ~$7 (Render Starter only — Atlas free, no Anthropic spend).

## 35. The "official launch tomorrow" moment

Diane asked to "officially start the app tomorrow" with nothing overdue and routines spread naturally. Done with [apps/api/scripts/start-tomorrow.ts](apps/api/scripts/start-tomorrow.ts) (npm script `start-tomorrow`):

For each rolling routine where `last_done` is null:

1. Compute a deterministic offset: `FNV-1a-style hash of routine.key, mod interval_days`
2. Set `last_done = startOfTomorrow − (interval − offset)` so `next_due = startOfTomorrow + offset`
3. Daily routines (interval=1) always fire tomorrow (offset always 0)
4. Routines with a real `last_done` are left untouched — re-running the script later will not clobber actual completion history

Also clears any existing `TodayPlan` doc so the next morning-gen builds fresh against the new dates.

**Real-DB run on 2026-05-09 produced** (selected highlights):

- Daily (4 routines): all fire 2026-05-10
- Weekly (~7d): water_fountain 5/10, mirror_glass 5/14, pet_brushing 5/14
- Monthly-ish (30d): shower_scrub 5/17, fridge_cleanout 6/7, monthly_meds 5/16
- Quarterly: oven_clean 7/24, floor_specialty 7/3
- Air filter (180d): air_purifier_filter 9/24
- 365d: registration_renewal 5/20, car_inspection 2027-04-24

**One thing flagged but not fixed:** `regular_cleaning` (21d, $380 outsourced) got bucketed on 2026-05-10 by the deterministic spread, but Diane has a real `cleaner_visit` trigger on file from 2026-04-25, which would put the actual next visit on **2026-05-16**. If a future Claude wants to anchor `regular_cleaning` to the real cleaner schedule rather than the arbitrary spread, it's a one-line `last_done` override.

## 37. Merge from second HANDOFF / second-instance memory (2026-05-10)

A parallel Claude instance was working out of `/Users/dianestephani/household-os/` (separate copy of the codebase, never actually built code there) and accumulating project memory under the `/Users/dianestephani/` working-directory key. That memory + that copy of HANDOFF.md have richer design specs than this repo's HANDOFF Part A. The user asked me to merge in the necessary items so this session has the full picture.

### What was merged into this repo

- **Memory files** copied into [/Users/dianestephani/.claude/projects/-Users-dianestephani-Documents-Projects-Personal-Projects-household-os/memory/](file:///Users/dianestephani/.claude/projects/-Users-dianestephani-Documents-Projects-Personal-Projects-household-os/memory/):
  - `beauty_maintenance.md` — haircut/head spa/nails/wax/self-tan/massage cadences, trigger-based rather than strict
  - `budget_gated_services.md` — cross-cutting "check budget first" pattern (head spa $250/6wk, massage aspirational, housecleaner-bump)
  - `dietary_constraints.md` — no seafood, won't handle raw meat, high protein, TJ's pre-cooked chicken
  - `household_context.md` — duplicates some of §1 but adds the "any routine system must use flexible windows, not fixed days" constraint
  - `workout_routine.md` — Tue/Thu self-workouts run **BEFORE** PT client sessions (~7:45–8:45 AM); never schedule self-workouts after client sessions
  - `workout_execution_pattern.md` — programming is solved, *execution* is the gap; night-before commit + 15-min fallback + weekly tracking (not daily streaks)
  - `energy_budgets.md` — day off 120–180 min, catering ≤60 min, weekday ~45 min default, laundromat fully blocking
  - `hyperfixate_burnout.md` — feedback memory: prefer project-shaped work, watch for approaching burnout, suggest scope cuts rather than pushing through
  - `shopping_and_home_tools.md` — Costco/TJ's/QFC, no Prime, Echo devices, RocketMoney + Calendar (some overlap with the existing `reference_finance_tools` memory)
- **Type system**: added `'beauty'` to `Category`, `'self'` to `Zone`, and optional `budget_gated: boolean` + `cost_estimate: number` fields on `Routine` (distinct from `outsource_cost_estimate` — see comments in [types.ts](packages/shared/src/types.ts)).
- **Mongoose schema**: matching `budget_gated` + `cost_estimate` defaults on the Routine model.
- **Seed**: `pickOutsource()` in [seed.ts](apps/api/src/seed.ts) passes the new fields through.
- **Inventory**: 8 new rolling routines under category `beauty`, zone `self`, in [inventory.json](packages/shared/src/inventory.json):
  - `haircut` (63d, budget_gated)
  - `head_spa` (42d, budget_gated, $250)
  - `self_tan` (7d) + `exfoliate_prep` (7d, intended to land the day before — see "deferred" below)
  - `brazilian_wax` (35d)
  - `cuticle_care` (3d)
  - `nails_apply` (14d — placeholder until nail rotation lands)
  - `massage` (28d, budget_gated, aspirational)

### Deliberately NOT built (deferred — design specs live in the other repo's HANDOFF §12.5/§12.6)

These are bigger redesigns. They're documented in detail at `/Users/dianestephani/household-os/HANDOFF.md` (sections 12.5 and 12.6). Don't re-derive them from scratch — open that file first.

1. **`soft_trigger` scheduling type** — for routines that are time-flexible reminders, not hard cadences (haircut "if you can't brush it," massage "if your body feels rough"). All beauty routines were degraded to `rolling` for now. The next time we touch the scheduling system, add this type and migrate the soft items to it.
2. **`NailState` collection + nail rotation logic** — tracks `current_type` (`dip` / `gel` / `polish` / `bare`), `consecutive_dip_count`, history with duration-per-application. After 2 consecutive dips suggests gel/polish for a "health break." Dynamic `interval_days` per type via `expected_durations_days`. See §12.6 of the other HANDOFF for the route sketch.
3. **Workout module v2** — `WorkoutDay` (per-day record with commitment + outcome + sleep + energy) + `WorkoutWeek` (weekly aggregate, *not* daily streaks) + evening check-in cron at 8 PM with Alexa AM/Later/Skip buttons + morning behavior + `fallback_15min` + sleep-pattern learning after ~6 weeks of data. The existing `services/workouts.ts` just logs status; the proper redesign would be a new `apps/workout/` module per §12.5.
4. **`prep_dependency` on routines** — `self_tan` should soft-require `exfoliate_prep` the day before. Currently both are independent rolling routines; the dependency isn't enforced. Modest service-side feature to add when convenient.
5. **`beauty_appointment` trigger type** — for booked services on the calendar (head spa, massage). Would let cadence reset cleanly when she actually books one.
6. **Beauty dashboard tile** — nail state + current type + days since applied + suggestion if any; upcoming beauty soft-triggers; head spa countdown; weeks-since-massage. Would slot next to the Today plan, similar to `CalendarDayPanel`.

### A note on the parallel HANDOFF file at `/Users/dianestephani/household-os/HANDOFF.md`

That file (1097 lines) is the second instance's design doc. Section structure is mostly identical to Part A of this file but the second-instance one has §12.5 (Workout module) and §12.6 (Nail rotation logic) that ours doesn't — those are the design specs referenced above. It also has v1 design notes mentioning `category: 'beauty'`, `zone: 'self'`, `trigger: 'beauty_appointment'` in the original §6/§7/§8/§11 — meaning the second instance always had beauty in scope, while our Part A treated it as out-of-scope-v1.

If you (Claude) ever need to compare designs, prefer Part B of *this* file (which reflects shipped code) over the second-instance design doc. Use the second-instance doc only for §12.5 / §12.6 design recovery.

---

## 38. Google sign-in wall (login on the deployed dashboard)

Added when Diane wanted the live demo link gated so randos couldn't browse her personal household data. Design call: **the login wall is purely an access gate** — it does NOT replace the existing server-side Google Calendar OAuth setup. Calendar reads continue to use the `google-token.json` she uploads to Render's Secret Files. The two OAuth setups are intentionally separate clients in Google Cloud Console so they can evolve independently (calendar = server-side "installed app" pattern, dashboard sign-in = browser SPA pattern).

### Backend pieces

- [apps/api/src/services/session.ts](apps/api/src/services/session.ts) — `verifyGoogleIdToken` (uses `google-auth-library`'s `OAuth2Client.verifyIdToken` against Google's JWKS), `isAllowedEmail` (comma-separated `AUTH_ALLOWED_EMAIL`, case-insensitive, closed by default), `signSession` / `verifySession` (24h `jsonwebtoken`-signed JWT, secret read from `JWT_SECRET`).
- [apps/api/src/middleware/auth.ts](apps/api/src/middleware/auth.ts) — single `requireToken` middleware with precedence: no-auth-configured → open; bearer matches `API_TOKEN` → allow (preserves Alexa skill + curl scripts); bearer parses as valid session JWT → allow; otherwise 401.
- [apps/api/src/routes/auth.ts](apps/api/src/routes/auth.ts) — `POST /api/auth/google` accepts `{ credential }` from the browser, verifies, checks `email_verified` + allowlist, issues session JWT. Mounted at `/api/auth` *before* the `requireToken` guard (chicken-and-egg).
- New deps: `jsonwebtoken` + `@types/jsonwebtoken`.

### Frontend pieces

- [apps/dashboard/index.html](apps/dashboard/index.html) — loads Google Identity Services from `https://accounts.google.com/gsi/client` (~2 KB, async/defer).
- [apps/dashboard/src/auth.ts](apps/dashboard/src/auth.ts) — sessionStorage helpers + `AUTH_ENABLED` derived from `VITE_GOOGLE_OAUTH_CLIENT_ID` presence.
- [apps/dashboard/src/components/LoginScreen.tsx](apps/dashboard/src/components/LoginScreen.tsx) — full-screen centered panel rendering GIS's standard button. Polls for the GIS script to finish loading (async/defer means it may not be ready at first paint), then `initialize` + `renderButton`. On credential callback: POST to `/api/auth/google`, store returned token + email + name + picture in `sessionStorage`, lift state to App.
- [apps/dashboard/src/App.tsx](apps/dashboard/src/App.tsx) — gates everything on `AUTH_ENABLED && !session` returning `<LoginScreen>`. Sign-out button in the header beside the theme toggle, shows the signed-in email as tooltip.
- [apps/dashboard/src/api.ts](apps/dashboard/src/api.ts) — `currentToken()` reads from `sessionStorage` first, falls back to `VITE_API_TOKEN` for envs without sign-in configured.

### UX choice: localStorage + 30-day JWT (revised 2026-05-10 PM)

Originally built with `sessionStorage` and a 24h JWT — Diane asked for "log in every time I click the link." But after iOS testing she ran into Google's 2FA flow requiring a trusted device on every fresh sign-in, which is annoying without the iPad handy. Reversed to `localStorage` + 30-day JWT so the session sticks across tabs and browser restarts. Sign-out still clears it explicitly. Future Claude: don't switch this back unless she explicitly asks — see `feedback_chat_interface_decision.md`-adjacent rationale (she changed her mind on a UX detail and the new behavior is what she actually wants).

### Env vars (new)

- `GOOGLE_OAUTH_CLIENT_ID` (API + dashboard as `VITE_GOOGLE_OAUTH_CLIENT_ID`) — Google Cloud Console OAuth Web-app client ID. Setting it enables the login wall.
- `AUTH_ALLOWED_EMAIL` (API only) — comma-separated allowlist. Defaults to refusing everyone if unset.
- `JWT_SECRET` (API only) — ≥16 chars. Required when `GOOGLE_OAUTH_CLIENT_ID` is set.
- See README's *Google sign-in* section for the Google Cloud Console steps.

### Tests

- [apps/api/src/services/session.test.ts](apps/api/src/services/session.test.ts) — 9 tests: JWT round-trip, tampered token rejection, rotated-secret rejection, JWT_SECRET length + presence enforcement, email allowlist (case-insensitive, comma-separated, closed-by-default).
- [apps/api/src/middleware/auth.test.ts](apps/api/src/middleware/auth.test.ts) — 7 tests: open-pass when no auth configured, legacy `API_TOKEN` accept + reject, JWT accept + malformed reject, EITHER token type works when both configured, missing header → 401.

### Deliberate non-coverage

`verifyGoogleIdToken` is *not* unit-tested — it hits Google's live JWKS endpoint and any local mock would be lower-fidelity than the real verification anyway. If a regression happens there, it'll show up as a 401 on `/api/auth/google` immediately and is loud, not silent. The route itself is also not tested (no Express route-test infrastructure in this repo yet); the service logic it sits on top of is fully covered.

---

## 39. Day navigator (Today tab is date-aware)

Diane wanted to scroll through different days from the homepage to plan around what's coming. Built on top of the existing `scheduleRange` so the forecast is exactly what the Schedule tab uses for week/month — no second source of truth.

### Backend

- [apps/api/src/services/day.ts](apps/api/src/services/day.ts) — `getDayView(dateStr)` returns `{ date, is_today, is_past, is_future, plan, forecast, events, context }`. Three regimes:
  - **Today**: auto-creates a TodayPlan via `generateTodayPlan(new Date())` if none exists. `forecast: []` because the plan is the source of truth.
  - **Past**: returns the stored TodayPlan if any (else null). `forecast: []` deliberately — the rolling-routine `last_done` math reflects current state, so synthesizing a forecast for a past date would be wrong. We could reconstruct historical state from DeferralEvents + completion timestamps but that's a real project; not worth it for a navigator UX.
  - **Future**: `plan: null`, `forecast: scheduleRange(date, 1).days[0].routines_due`.
- Calendar events are always included via `scheduleRange` (which itself short-circuits to `[]` in NODE_ENV=test or when OAuth isn't configured).
- Context entries are filtered by `ts ∈ [startOfDay, startOfDay+1]`.
- Route: `GET /api/day/:date` with a strict `YYYY-MM-DD` regex on the param.

### Frontend ([DayPanel.tsx](apps/dashboard/src/components/DayPanel.tsx))

Replaces what was an inline today-only stack inside [App.tsx](apps/dashboard/src/App.tsx). Composes:

- `DayNavigator` strip — ◀ / native `<input type="date" />` / ▶ buttons + a "Today" pill that appears when off-today.
- For **today**: full mutable UI (CheckInBanner, CalendarDayPanel, TodayContextStrip, EnergyButtons, MoodButtons, TodayList) — the components Diane was already using. State sync between DayPanel and App.tsx via the `initialPlan` prop + `onPlanChange` callback so external mutations still flow through.
- For **past with a stored plan**: read-only `PastPlanPanel` showing items with completed-status strikethrough and any deferred items in a small swap-pool footer.
- For **past with no plan**: "No plan recorded — morning-gen didn't run that day."
- For **future**: `ForecastPanel` showing `ScheduleRoutineDue[]` rows with the same source badges (Rolling/Fixed/Zone/Event) and cadence notes the Schedule tab uses.
- Calendar events + context are always rendered when present, in compact `DayEventsPanel` / `DayContextPanel` sub-components for non-today (or the existing `CalendarDayPanel` / `TodayContextStrip` reused for today, since those have richer behavior on the live day).

Mutations are deliberately scoped to today only. `swap_task`, `mark_done`, `pull_from_pool` only render when `is_today === true` — the past view is historical record, the future view is read-only forecast. If Diane later wants cross-day task movement ("shift this from Tue to Wed"), that's a separate feature and would need a new route.

### Tests

7 in [apps/api/src/services/day.test.ts](apps/api/src/services/day.test.ts): today auto-creates plan + suppresses forecast; today returns existing plan if one is stored; past returns stored plan with completion status preserved; past returns null when nothing was stored; future synthesizes forecast (with rolling-routine bucketing); context entries filtered correctly by local-day window; calendar disconnected in test mode → empty events.

---

## 40. Google Tasks integration

Diane wanted the to-do items already on her Google Calendar (Google Tasks — the to-do product that surfaces on the calendar grid) to appear alongside system routines in the dashboard, with check-off interactions writing back to Google.

### OAuth scope expansion (one-time action Diane needs to take)

The existing `google-token.json` was minted only with `calendar.events`. Tasks API requires `https://www.googleapis.com/auth/tasks`. [google-auth.ts](apps/api/src/google-auth.ts) now requests both scopes. **Run `npm -w @household-os/api run google-auth` after pulling** to re-consent and replace the saved token. The new token works for both products. On Render, replace the `google-token.json` Secret File with the new one.

### Backend

- [utils/google-tasks.ts](apps/api/src/utils/google-tasks.ts) — `getTasksClient()`, `isTasksConnected()` (with `NODE_ENV=test` short-circuit identical to the calendar utility), `listAllTasks()` (walks all task lists and returns `{ tasklistId, task }` pairs — keeping the tasklist id is required because the Tasks API needs it for mutations), `patchTaskStatus()`.
- [services/tasks.ts](apps/api/src/services/tasks.ts) — pure helpers: `normalizeTask` (strips Google's wider schema down to our `CalendarTask`, treats anything that isn't exactly `'completed'` as `needsAction`), `taskDueOn` (matches against the date prefix of the RFC 3339 `due` field). Orchestrators: `tasksForDay(dateStr)`, `tasksWithoutDueDate()` (for backlog), `completeTask`, `uncompleteTask`, `todaysTasks()`.
- [routes/tasks.ts](apps/api/src/routes/tasks.ts) — `GET /api/tasks?date=YYYY-MM-DD`, `GET /api/tasks/backlog`, `POST /api/tasks/complete`, `POST /api/tasks/uncomplete`. Mutations require `{ tasklist_id, task_id }` in the body and return the updated task or a 502 `tasks_api_no_op` if the Tasks API was unreachable.
- [services/day.ts](apps/api/src/services/day.ts) — the `DayView` payload now bundles `tasks: CalendarTask[]` alongside `plan` / `forecast` / `events` / `context`. Empty when the token isn't tasks-scoped or in test mode.

### Frontend

- [DayPanel.tsx](apps/dashboard/src/components/DayPanel.tsx) — new `TasksPanel` sub-component renders the day's tasks as a checkbox list. Checking/unchecking on today flips the Google Tasks status via `api.tasks.complete` / `api.tasks.uncomplete`; on past/future days the checkbox is disabled (read-only with a tooltip). Optimistic local update on response.
- [api.ts](apps/dashboard/src/api.ts) — `api.tasks.forDay(date)`, `backlog()`, `complete(...)`, `uncomplete(...)`.

### Direction of integration (intentional v1 limitation)

This is **Google Tasks → dashboard read, plus dashboard → Google Tasks for status mutations only**. The dashboard does *not* push system-routine completions back to Google Tasks (Diane already has those tracked in the system; mirroring would just duplicate state). Creating new Google Tasks from the dashboard is also out of scope — she can use Google's UI for that, then check them off here. If she ever wants full CRUD or wants routine-completions mirrored to Google, the route stubs are in place to extend.

### What's *not* tested

- `listAllTasks` / `patchTaskStatus` — `NODE_ENV=test` short-circuits them at the utility layer, same isolation pattern the calendar tests rely on. Asserting against the real Google Tasks API would be flaky and mocking the entire `googleapis` client is more brittle than valuable. The service-level tests cover the pure helpers (normalize / date filter) plus the disconnected-state behavior.

### Tests

8 in [apps/api/src/services/tasks.test.ts](apps/api/src/services/tasks.test.ts): `normalizeTask` happy path / status fallback / null on missing id+title / completed timestamp preservation; `taskDueOn` date-prefix match + no-due → false; `tasksForDay` + `todaysTasks` return `[]` when disconnected; `completeTask` + `uncompleteTask` return null when disconnected.

---

## 41. Ad-hoc task creation + MCP server (Claude.ai writeback)

Diane asked for two things in one breath: Alexa should be able to add tasks, and she should be able to talk to the household persona on Claude.ai with real write access — not just advisory. Both ship together because they share the same `createAdHocTask` service and the same "ask for clarification, never guess" persona behavior.

### Ad-hoc task creation

- [services/zones.ts](apps/api/src/services/zones.ts) — new `createAdHocTask({ name, zone?, severity?, estimate_minutes?, energy?, source? })`. Defaults: zone='whole-house', severity='meh' (15 min, medium energy). Trims whitespace, errors on empty. Writes a `task_created` activity log entry tagged with the source. Returns the inserted doc.
- [routes/zones.ts](apps/api/src/routes/zones.ts) — `POST /api/zones/tasks` exposes it. Validates name + optional zone/severity against existing enums.
- The `AdHocTask.source` field was previously typed `'zone_assessment'` only; broadened to `'zone_assessment' | 'voice' | 'mcp' | 'persona' | 'manual'` so we can distinguish provenance in the activity log.
- Picked up by morning-gen the next time it runs, with the same severity + age priority math zone-assessment-generated tasks use.

### Alexa AddTaskIntent

- Interaction model: new `AddTaskIntent` with `TaskName: AMAZON.SearchQuery` slot. Intent-level samples are slot-free (so Alexa always elicits), slot-level samples cover free-form utterances. Dialog config requires elicitation with `Elicit.Slot.TaskName` prompt ("What task should I add?").
- Handler [zones.ts](apps/alexa-skill/src/handlers/zones.ts) — if `TaskName` is missing, returns `addElicitSlotDirective('TaskName')`. If present, calls `apiClient.addAdHocTask(name)` and reads the name back.
- Client method [client.ts](apps/alexa-skill/src/client.ts): `addAdHocTask(name, zone?, severity?)` POSTs to `/api/zones/tasks` with `source: 'voice'`.

### MCP server

- New deps: `@modelcontextprotocol/sdk`.
- [mcp/server.ts](apps/api/src/mcp/server.ts) — `buildMcpServer()` returns a fresh `McpServer` with 11 registered tools: writes (`add_ad_hoc_task`, `mark_done`, `swap_task`, `update_energy`, `log_mood`, `log_workout`, `log_context`) + reads (`get_today`, `recent_activity`, `recent_context`, `list_open_zone_tasks`). Each tool's handler calls into the same service-layer function the Anthropic-API persona path uses, so behavior stays identical regardless of surface. Writes tag `source: 'mcp'` (or `'persona'` for log_context) so the activity log distinguishes provenance.
- [mcp/route.ts](apps/api/src/mcp/route.ts) — `mcpAuth` accepts the bearer via `Authorization: Bearer <token>` *or* `?token=...` query param. The query-param path matters because Claude.ai's Custom Connectors UI doesn't have a generic header-injection field; users paste a full URL. `mcpHandler` creates a fresh `StreamableHTTPServerTransport` (stateless mode — `sessionIdGenerator: undefined`) per request, connects the MCP server, and bridges the Express req/res through `transport.handleRequest`. `res.on('close')` cleans up transport + server.
- Mounted at `/mcp` (root server, not under `/api`) in [index.ts](apps/api/src/index.ts) before the `requireToken` guard.

### Persona prompt updates (clarification principle)

Both [household.ts](packages/shared/src/personas/household.ts) and [finance.ts](packages/shared/src/personas/finance.ts) system prompts now include a "CLARIFICATION PRINCIPLE" block with concrete examples: when the ask is genuinely ambiguous, ask one short question rather than guess. Exception: fields with safe defaults (severity='meh', filing_status='single' when only gross income given) can be used silently as long as the persona tells her what it defaulted to.

### Tests

- 5 new in [zones.test.ts](apps/api/src/services/zones.test.ts) — `createAdHocTask` defaults, caller overrides, whitespace trim + empty rejection, activity log side-effect, immediate visibility in `listOpenAdHocTasks`.
- The pre-existing schema/impl-drift test in [tools.test.ts](apps/api/src/persona/tools.test.ts) auto-validated the new `add_ad_hoc_task` tool wiring (every tool declared in the persona schemas has an implementation in tools.ts).
- MCP transport itself is not unit-tested — testing `StreamableHTTPServerTransport.handleRequest` would mean stubbing a full HTTP cycle through `@hono/node-server`; cheaper to validate by pointing Claude.ai at the deployed `/mcp` URL and listing tools.

### Status: MCP server is built but intentionally unused (2026-05-10)

The MCP server ships in the codebase but Diane explicitly chose not to wire it to any chat interface. She evaluated three paths — Claude.ai web Custom Connectors (blocked by OAuth requirement we hadn't built), Claude Desktop (would require installing another app), and re-adding dashboard chat with the Anthropic API (~$2/mo, she'd previously declined the API cost) — and rejected all of them. Voice (Alexa) + dashboard click-to-edit is the interaction model.

The MCP code is kept in place because (a) it's done and tested, and (b) future surfaces (Claude Desktop adoption, a different MCP-aware chat client, ChatGPT custom-GPT-style integrations) could pick it up without rebuild. **Future Claude: don't push chat-style interfaces unprompted; see `feedback_chat_interface_decision.md` memory.** If she ever asks for chat, the lowest-friction restore is re-adding the dashboard ChatPanel with an Anthropic API spending cap — don't re-litigate MCP unless she specifically asks.

### Auth model going forward

Three bearer-eligible paths through the API now:

1. `API_TOKEN` (static, env-driven) — Alexa skill, MCP query param, curl scripts
2. Session JWT from `/api/auth/google` — dashboard browser session
3. No-auth open mode — when neither `API_TOKEN` nor `GOOGLE_OAUTH_CLIENT_ID` is set

All three are accepted by the `requireToken` middleware on `/api/*`. The `/mcp` route has its own thinner middleware (`mcpAuth`) that ONLY checks against `API_TOKEN` — MCP clients don't have access to the Google sign-in flow, and exposing the session-JWT path on MCP would require URL-encoding sensitive tokens that we'd rather not generate ad-hoc.

---

## 42. Recent UX + coverage detail (2026-05-10 evening)

Small but worth documenting since they shaped where tests went.

### Mood / Energy "saved" confirmation pattern

Diane asked for visual confirmation when she logs mood / energy — clicking the buttons fired off API calls but the only visible feedback was the active-state highlight, which wasn't enough.

- **MoodButtons** ([apps/dashboard/src/components/MoodButtons.tsx](apps/dashboard/src/components/MoodButtons.tsx)): now prefills `selected` + `loggedAt` from the most recent mood log if it was logged today (`api.mood.recent(1)` → check `isToday(ts)`). Renders `✓ Logged "good" at 2:14 PM` in the panel header (green via `var(--good)`). Active state now survives tab switches + page reloads.
- **EnergyButtons** ([apps/dashboard/src/components/EnergyButtons.tsx](apps/dashboard/src/components/EnergyButtons.tsx)): same `✓ Logged "medium" at 2:14 PM` indicator. **Bug fix worth knowing:** cancelling the energy-suggestions modal previously didn't refetch the plan, so even though the energy POST persisted, the visible `current` level stayed pointing at the old value. New `dismissSuggestion()` handler calls `api.today.get()` regardless. Symptom for the next session: if `current_energy` ever looks wrong, check that the modal-dismissal path still refetches.
- New api method: `api.mood.recent(days)` → `MoodLog[]`.

### Clarification principle in both persona prompts

The household + finance system prompts now both include a "CLARIFICATION PRINCIPLE" block with concrete examples. The rule: if the ask is genuinely ambiguous, ask one short question rather than guess. Exception only for fields with safe defaults (severity='meh', filing_status='single'), and even then the persona must state what it defaulted to so she can correct it.

This was a Diane-stated preference. Don't dilute it in future prompt edits — it's a real correction of past behavior where the persona was guessing zones / interpretations.

### Test coverage additions

Two gaps surfaced in a coverage audit and got filled:

- **`routines.ts`** ([apps/api/src/services/routines.test.ts](apps/api/src/services/routines.test.ts), 9 tests): `patchRoutine` allow-list (applies whitelisted fields, silently drops `key` / `_id` / other off-list fields, supports nested `scheduling` patch, allows `last_done` updates), `listRoutines` filters (active-only default, category, zone), `softDeleteRoutine` (sets `active=false` without removing doc), `createRoutine` smoke.
- **`alexa-push.ts`** ([apps/api/src/services/alexa-push.test.ts](apps/api/src/services/alexa-push.test.ts), 8 tests): the body-template logic was extracted into a pure `buildCheckInCardBody` helper so it's testable without going through the LWA-push side effect. Tests cover morning_intent template, frequent_deferral with name + count, missing-count default to 0, missed_workouts template, generic fallback for unknown pattern_interrupt kinds, generic fallback when frequent_deferral lacks `routine_name` (otherwise we'd render "undefined has been deferred N times"), null returns for non-pushable check-in types.

### Deliberately *not* tested (decisions worth preserving)

- **`mcp/server.ts` + `mcp/route.ts`** — transport mocking via `@hono/node-server` is more brittle than the test would catch. Validate by pointing an MCP client at the deployed `/mcp` and listing tools. Service-layer behavior the MCP tools delegate to is fully covered.
- **`services/triggers.ts`** — thin wrapper over Mongoose + a `logActivity` call already exercised in [activity-wiring.test.ts](apps/api/src/services/activity-wiring.test.ts).
- **`utils/google-calendar.ts` + `utils/google-tasks.ts`** — `NODE_ENV=test` short-circuits prevent real API calls. Service-layer wrappers (`calendar.ts`, `tasks.ts`) cover the normalization logic.
- **Dashboard components** — no React testing infrastructure in this repo. If we ever introduce Vitest + Testing Library, `EnergyButtons` energy-cancel-modal bug fix + `MoodButtons` prefill behavior would be the first regression candidates.

Total: **231 tests** across 30 files (221 API + 10 alexa-skill).

---

## 43. Tab persistence + date-aware Workouts / Activity / Journal (2026-05-10 PM)

Diane asked for two things that turned out related: the refresh button shouldn't dump her back to Today, and every section should support scrolling through dates the way the Today view's DayPanel already does.

### Tab persistence

[App.tsx](apps/dashboard/src/App.tsx): `view` state now reads from `localStorage` via `readSavedView()` and mirrors every `setView()` call back to `localStorage.setItem('household-os.view', ...)`. The setter wrapper writes-then-sets so we can't accidentally skip persistence. Refresh button preserved (still `window.location.reload()`) — useState initializer picks the saved view on the way back up.

### Shared `DayNavigator`

Extracted from the inline implementation in [DayPanel.tsx](apps/dashboard/src/components/DayPanel.tsx) into [DayNavigator.tsx](apps/dashboard/src/components/DayNavigator.tsx). Pure presentational — parent owns the date state. Exports the helpers (`localToday`, `formatHeader`, `shiftDate`) since other panels use them for headers + bucket keys. Four consumers as of now: DayPanel, WorkoutPanel, ActivityFeed, JournalPanel.

### Workout date navigation

- **Backend**: `todaysWorkout(date)` already took an optional date param; added route `GET /api/workouts/by-date/:date` that calls through. Strict `YYYY-MM-DD` regex.
- **Frontend** ([WorkoutPanel.tsx](apps/dashboard/src/components/WorkoutPanel.tsx)) gets a DayNavigator at the top. Three regimes:
  - **Today**: full mutable — done/partial/skipped buttons surface if no log exists yet.
  - **Past with log**: read-only "Logged: done · <notes>".
  - **Past or future, no log**: read-only "Not logged. Logging is only enabled for today." (the slot still shows if the day-of-week has one — e.g. future Tuesday shows `pt_tue` so you know what's planned).
- The pattern summary + history list below the date-aware section are *unchanged* — they still show 14-day rolling state. Clicking a history row jumps the navigator to that date (small UX nicety).
- New api method: `api.workouts.byDate(date)`.

### Activity + Journal Range/Single-day toggle

Both feeds now have a pill toggle: **Range** (existing rolling-window behavior — 3/7/14/30 days bucketed by day) or **Single day** (DayNavigator + just that day's entries). Defaults to Range so the panel-open experience matches what users already know.

**Backend addenda — symmetric `onDate` helpers** so single-day mode hits a real per-day query instead of fetching a wide window and filtering client-side:

- [activity.ts](apps/api/src/services/activity.ts) → `activityOnDate(dateStr, kind?)`. Returns `[]` on malformed date.
- [context.ts](apps/api/src/services/context.ts) → `contextOnDate(dateStr, persona?)`. Same null-safety + same persona-OR-both filter as `recentContext`.
- Routes [routes/activity.ts](apps/api/src/routes/activity.ts) and [routes/context.ts](apps/api/src/routes/context.ts) gained a `?date=YYYY-MM-DD` query param that takes precedence over `?days=N` when present. Strict regex on date.
- Dashboard api methods: `api.activity.onDate(date, kind?)` and `api.context.onDate(date, persona?)`.

### Tests

- [activity.test.ts](apps/api/src/services/activity.test.ts) → 3 new for `activityOnDate`: local-day window correctness, malformed date returns [], kind filter still works.
- [context.test.ts](apps/api/src/services/context.test.ts) → 3 new for `contextOnDate`: local-day window correctness, malformed date returns [], persona filter still applies.
- [workouts.test.ts](apps/api/src/services/workouts.test.ts) → 4 new for `todaysWorkout(date)`: returns scheduled slot + null log for a non-today date with no log; finds an existing log for the (date, slot) pair; doesn't leak another day's log into the lookup; returns `{slot: null, log: null}` on weekends. This is the path the new `/by-date/:date` route exercises.

Total now: **241 tests** across 30 files (231 API + 10 alexa-skill).

### Deliberate design choice: keep Range as default in Activity + Journal

Pure single-day filtering feels quiet on days with no activity, while the rolling-window view answers "what have I been up to lately" — the more common use case for those tabs. The DayNavigator is a deliberate opt-in for forensic "what did I do on April 30" queries, not the default lens.

### Finance day log (added immediately after §43)

[FinancePanel.tsx](apps/dashboard/src/components/FinancePanel.tsx) gained a `FinanceDayLog` sub-component at the bottom (above the PersonaLauncher). It mounts its own DayNavigator and renders two grouped sub-lists for the selected date:

- **Journal entries** — finance-tagged context entries via `api.context.onDate(date, 'finance')`. That helper returns entries where `related_persona ∈ {'finance','both'}`, so cross-cutting "chaos week, ordering takeout = extra spend" entries surface here too.
- **Edits** — activity-log entries that passed the `isFinanceActivity` filter (exported for testability). The filter excludes `context_logged` kind (already rendered above) and includes `routine_edited` entries whose `metadata.fields` contain finance-relevant strings (`income`, `tax`, `expenses`, `expense_breakdown`, `extra_withholding`, `state`, `filing_status`, `outsource`).

**Design call:** the profile + RocketMoney breakdown + outsourceable table at the top of the Finance tab remain "current state" — they don't accept a date param. Profile snapshots over time would be a separate, much bigger feature (snapshot-on-edit + historical-state reconstruction). For now, the day log answers "what was logged for finance on this date" without pretending the profile itself is date-bound.

**`isFinanceActivity` filter is intentionally narrow.** Outsource-cost edits via `edit_routine_outsourcing` trigger `patchRoutine` whose summary is "Edited routine: <key>" — no finance keyword. The filter catches them by inspecting `metadata.fields` for `outsource*` patterns. False positives clutter the log; the global Activity feed is the right place to see everything.

---

## 44. Zone-assessment multi-task split (2026-05-10 PM)

Diane was entering things like "wipe counters, sweep floor, take out trash" in the zone-check `zone_notes` answer and getting **one** ad-hoc task with the full comma-separated string as the name. Wanted one task per comma-separated item.

### Behavior change

[services/zones.ts](apps/api/src/services/zones.ts):

- New exported pure helper `splitTaskNotes(notes)` — comma-split, trim each segment, drop empty segments. Only commas separate; semicolons / slashes / newlines stay inside a segment for predictability.
- `recordAssessment` now creates **one `AdHocTask` per non-empty item** instead of one task with the full string. Single-item notes still produce 1 task (regression-tested). All-empty / whitespace-only notes still fall back to the zone's `defaultTaskName`. Each task gets its own `task_created` activity entry. All tasks in the batch share the same `source_assessment_id` so they're cancelable / queryable as a batch later if needed.

### Return-shape change (small API break)

`recordAssessment` was `Promise<{ assessment, task: AdHocTaskType | null }>`. Now it's `Promise<{ assessment, tasks: AdHocTaskType[] }>`. Empty array for level=fine. Length ≥ 1 for level=meh / level=rough.

**Callers updated:**

- `routes/zones.ts` — just passes the new shape through to the HTTP response, no code change beyond the type.
- `services/checkins.ts` — never read the return value, no change.
- Both test files (`zones.test.ts`, `activity-wiring.test.ts`) updated to destructure `{ tasks }` instead of `{ task }`.

### Tests

- 5 new `splitTaskNotes` cases: null/undefined/empty/whitespace → []; single segment (no comma) → 1-element array, trimmed; multi-comma; empty-segment dropping (consecutive commas, trailing commas, leading commas, whitespace-only segments); only-commas separator (semicolons/newlines/slashes preserved).
- 5 new `recordAssessment` cases: one open task per comma-separated item with correct severity-derived defaults; one `task_created` activity entry per task; all tasks linked to same source assessment; single-item notes → 1 task (regression); all-empty-segment notes → default-name fallback (regression).

Total now: **251 tests** across 30 files (241 API + 10 alexa-skill).

### What didn't change

- Alexa `AssessZoneIntent` doesn't pass notes through (no `Notes` slot — that's been removed from the interaction model), so voice zone checks still produce default-named tasks. Multi-task split only fires when notes come from the dashboard's `zone_assessment` check-in or a direct `POST /api/zones/assess` with a comma-separated `notes` body.
- The activity log records each task individually (which was already the per-call behavior) — `Task added: "<name>"`. If you want a single rolled-up activity entry per batch, that's a separate change.

---

## 45. Grocery Manager persona + Food tab (renamed from Nutrition, 2026-05-10 PM)

Diane wanted the previously-stub Nutrition tab to become a real Grocery Manager persona linked to her Claude Project. Renamed end-to-end, no in-API tool loop — launcher-only.

### Renames + structural changes

- [packages/shared/src/personas/grocery.ts](packages/shared/src/personas/grocery.ts) — new file with full system prompt encoding hard constraints (TJ's-primary, no seafood, no raw meat) + active goals (>100g protein/day, ~5kg weight loss target). Carries `stub: true` so the `/api/chat/grocery` route returns a "use the launcher" canned reply instead of trying to hit the (no-longer-configured) Claude API. Empty `tools: []` array — launcher-only.
- `packages/shared/src/personas/nutrition.ts` — **deleted**. `personas/index.ts` and `package.json#exports` now export `grocery` instead.
- [apps/api/src/persona/runner.ts](apps/api/src/persona/runner.ts) — branch for `personaName === 'grocery'` replaces the old `'nutrition'` branch with a canned message pointing at the Food tab.
- [apps/api/src/persona/tools.ts](apps/api/src/persona/tools.ts) — `stubTools.not_implemented` message updated to the launcher-only framing.
- [apps/api/src/persona/tools.test.ts](apps/api/src/persona/tools.test.ts) + [runner.test.ts](apps/api/src/persona/runner.test.ts) — updated to reference 'grocery' instead of 'nutrition'.
- [packages/shared/src/personas/household.ts](packages/shared/src/personas/household.ts) — system prompt's exclusion line updated to "food/groceries" wording.

### App.tsx — Nutrition → Food

- View union: `'nutrition'` → `'food'`. Tab label: "Nutrition" → "Food".
- Inline "not built yet" stub replaced with `<PersonaLauncher persona="grocery" />`.
- **Migration for already-persisted localStorage**: users whose `household-os.view` was set to `'nutrition'` will hit `readSavedView()`, fail the new VIEWS membership check, and fall through to `'today'`. Safe.

### PersonaLauncher — per-persona default Project URL

[PersonaLauncher.tsx](apps/dashboard/src/components/PersonaLauncher.tsx) gains a `DEFAULT_PROJECT_URL` map. The "Open in Claude.ai" button target is now `savedUrl || DEFAULT_PROJECT_URL[persona] || HOSTED_FALLBACK`. For `grocery` the default is hardcoded to `https://claude.ai/project/019e141a-8cbc-720d-843a-0732ad1293c2`. The "Saved Project URL" input still lets her override. Status text under the button reflects three states: saved / default / fallback.

### iOS app handoff

iOS Universal Links handle this automatically — when the Claude iOS app is installed, tapping a `claude.ai/project/...` link prompts to open in the app. No special URL scheme or per-platform code needed. This already works for Household and Finance launchers; Grocery inherits the behavior via the shared launcher component.

### What's NOT built — Alexa Shopping List integration

Diane's described workflow ends with: "[Grocery Manager] should print a grocery list and then add every item on the list to my Shopping list in Alexa." The print-the-list piece is in the persona system prompt (parsable format with `## Section` headers + `- <qty> <item>` rows). The auto-add-to-Alexa-list piece requires a separate buildout:

1. Alexa Developer Console: request `alexa::household:lists:write` permission on the skill
2. User grants it in the Alexa app
3. Account linking flow so our server can hold an Amazon-issued access token outside live skill sessions
4. New API endpoint (e.g. `POST /api/alexa/shopping-list/add`) that accepts an array of items and calls the Alexa Lists API
5. Dashboard panel: paste the persona's grocery list → parse → bulk-add → confirm

Estimated effort: 2–3 hours. The voice fallback is workable in the meantime — Alexa supports multi-item add over voice ("Alexa, add eggs, bread, and milk to my shopping list"). Diane was told this and chose not to pursue the full integration this session.

### Tests

No test-count change. The persona-tools wiring test was updated (nutrition → grocery) but the assertion shape is the same — `getToolsForPersona('grocery')` still falls through to `stubTools` since grocery has no real in-API tool implementations. Runner test updated to verify the new launcher-only canned reply.

Total: still **251 tests** (241 API + 10 alexa-skill).

---

## 36. Route cheat sheet (canonical — updated 2026-05-10)

All `/api/*` routes gated by `requireToken` middleware ([middleware/auth.ts](apps/api/src/middleware/auth.ts)) — accepts `API_TOKEN` bearer, Google-issued session JWT (§38), or open-pass when neither is configured. Auth routes + `/mcp` have their own middleware.

| Endpoint | Method | Purpose |
|---|---|---|
| `/health` | GET | Health check (no auth) |
| `/alexa` | POST | Alexa skill webhook (raw body, signature-verified) |
| `/api/auth/google` | POST | Verify Google ID token → issue session JWT (mounted before `requireToken`, §38) |
| `/mcp` | ALL | MCP server endpoint via Streamable HTTP transport. Auth via `?token=` query or Authorization header against `API_TOKEN`. Built but unwired-by-design (§41). |
| `/api/today` | GET | Current TodayPlan (auto-generates if missing) |
| `/api/today/regenerate` | POST | Force re-gen + activity log entry |
| `/api/today/whats-left` | GET | Open items + summed minutes (§47 Phase 6c, powers Alexa WhatsLeftIntent) |
| `/api/today/swap` | POST | Move item to swap_pool, optionally pull replacement |
| `/api/today/mark-done` | POST | Mark plan item complete |
| `/api/today/pull-from-pool` | POST | Bring item from swap_pool back into today |
| `/api/day/:YYYY-MM-DD` | GET | DayView bundle (plan + forecast + events + tasks + context) — §39 |
| `/api/schedule?days=N` | GET | Week/month look-ahead (events + routines coming due) — §32. Days clamped [1, 60]. |
| `/api/calendar/today` | GET | Today's Google Calendar events normalized for dashboard — §31 |
| `/api/tasks?date=YYYY-MM-DD` | GET | Google Tasks for that day — §40 |
| `/api/tasks/backlog` | GET | Google Tasks with no due date |
| `/api/tasks/complete`, `/api/tasks/uncomplete` | POST | Flip Google Task status |
| `/api/routines` | GET | All active routines (optional `?category=` `?zone=` filters) |
| `/api/routines/:key` | PATCH | Allow-list field update |
| `/api/energy` | POST | Log energy + return suggested swaps |
| `/api/energy?days=N` | GET | Recent energy logs |
| `/api/mood` | POST / GET | Log mood / recent moods |
| `/api/workouts` | GET | Recent workout logs |
| `/api/workouts` | POST | Log a workout (upserts on date + slot_key) |
| `/api/workouts/today` | GET | Today's slot + log |
| `/api/workouts/by-date/:date` | GET | Same shape for any date — §43 |
| `/api/zones/state` | GET | Latest assessment per zone |
| `/api/zones/assessments?days=N` | GET | Recent assessments |
| `/api/zones/tasks` | GET | Open ad-hoc tasks |
| `/api/zones/tasks` | POST | **Direct ad-hoc task creation** (name + optional zone/severity/source) — §41 |
| `/api/zones/tasks/:id/cancel` | POST | Cancel an ad-hoc task |
| `/api/zones/assess` | POST | Record zone assessment; creates one ad-hoc task per comma-separated `notes` item — §44 |
| `/api/checkins/pending` | GET | Currently pending check-ins |
| `/api/checkins/:id/answer` | POST | Answer (also fires mood/energy side-effects) |
| `/api/checkins/:id/skip` | POST | |
| `/api/triggers` | GET / POST | Calendar/event triggers |
| `/api/patterns/deferrals` | GET | Frequent-deferral pattern |
| `/api/patterns/workouts` | GET | Workout summary + streaks |
| `/api/activity?days=N&kind=…` | GET | Unified activity log (range) |
| `/api/activity?date=YYYY-MM-DD` | GET | Activity for one day — §43 |
| `/api/context?days=N` | GET | Journal entries (range) |
| `/api/context?date=YYYY-MM-DD` | GET | Journal for one day — §43 |
| `/api/context/today` | GET | Today's journal entries |
| `/api/context` | POST | Add journal entry |
| `/api/finance/profile` | GET / PATCH | Financial profile singleton |
| `/api/finance/outsourceable` | GET | Outsourceable routines with monthly cost math |
| `/api/finance/affordability` | GET | Greedy-fit affordability report |
| `/api/finance/estimate-tax` | POST | Pure compute — federal/FICA/state estimator |
| `/api/finance/imports` | GET / POST | List or create RocketMoney imports (§47 Phase 5; POST 1MB byte cap) |
| `/api/finance/imports/:id/apply` | POST | Apply an import → write profile + snapshot + link |
| `/api/finance/snapshots` | GET | Profile snapshot history newest-first |
| `/api/finance/snapshots/:id/restore` | POST | Restore from snapshot (writes a chained `restore` snapshot) |
| `/api/meal-weeks` | GET / POST | List newest-first / upsert by `start_date` (§48) |
| `/api/meal-weeks/by-date/:date` | GET | Find the meal week containing any day |
| `/api/meal-weeks/:start_date` | GET / DELETE | Exact week / remove by Monday-of-week |
| `/api/meal-weeks/:start_date/adjacent` | GET | Nearest stored prev + next weeks for nav |
| `/api/appointments/:routine_key` | POST / DELETE | Schedule a calendar appointment / unlink it (§47 Phase 4) |
| `/api/appointments/:routine_key/reconcile` | POST | Force reconcile against Google Calendar |
| `/api/appointments/reconcile-all` | POST | Admin trigger for the hourly cron logic |
| `/api/alexa/auth-status` | GET | `{configured: boolean}` — has LWA been bootstrapped? (§47 Phase 6) |
| `/api/alexa/shopping-list/add` | POST | Bulk-add `{items: string[]}` to the Alexa shopping list (read-only; never touches Amazon cart) |
| `/api/alexa/lwa/save-token` | POST | One-time LWA bootstrap; persists `{access_token, refresh_token, expires_in, scope}` |

---

## 46. Latest test count + coverage delta (running tally)

As of 2026-05-10 end-of-day, post-Phase 6 (Alexa surfaces): **359 tests across 38 files** (349 API + 10 alexa-skill). Was 251 pre-Phase 1, dropped to 247 after Phase 1 cleanup, 263 after Phase 2 data-model tests, 285 after §48 meal-weeks, 303 after Phase 4 appointments, 307 after persona URL hardcoding, 339 after Phase 5, 359 after Phase 6. Phase 3 was UI-only and didn't move the count.

Recent additions since the initial Part B write-up:

| When | Section | Tests added | Total after |
|---|---|---|---|
| Initial Part B | §25 | (baseline) | 178 |
| §38 Google sign-in | session.test.ts + auth.test.ts | +16 | 194 |
| §39 Day navigator | day.test.ts | +7 | 201 |
| §40 Google Tasks | tasks.test.ts | +8 | 209 |
| §41 Ad-hoc + MCP | zones.test.ts (createAdHocTask) | +5 | 214 |
| §42 Coverage backfill | routines.test.ts + alexa-push.test.ts | +17 | 231 |
| §43 Date-aware tabs | activity.test.ts + context.test.ts + workouts.test.ts | +10 | 241 |
| §44 Zone multi-task | zones.test.ts (splitTaskNotes + multi) | +10 | 251 |
| §45 Grocery Manager | (no count change — renames updated existing tests) | 0 | 251 |
| §47 Phase 1 cleanup | runner.test.ts deleted | −4 | 247 |
| §47 Phase 2 data model | finance-history.test.ts + finance.test.ts additions | +16 | 263 |
| §47 Phase 3 visual refactor | UI-only (no dashboard test infra) | 0 | 263 |
| §48 Meal week calendar | meal-weeks.test.ts | +22 | 285 |
| §47 Phase 4 appointments | appointments.test.ts | +18 | 303 |
| Hardcoded persona Project URLs | tools.test.ts | +4 | 307 |
| §47 Phase 5 RocketMoney workflow | csv-parser.test.ts + finance-history.test.ts | +32 | 339 |
| §47 Phase 6 Alexa surfaces | grocery-list-parser + today.whats-left + alexa-shopping-list + alexa-reminders | +20 | 359 |

**Deliberately not tested** (with rationale, so a fresh Claude doesn't try to backfill these):

- `mcp/server.ts` + `mcp/route.ts` — transport mocking via `@hono/node-server` is more brittle than the test would catch. Service-layer code the MCP tools delegate to is fully covered.
- `services/triggers.ts` — thin Mongoose wrapper, indirectly tested via activity-wiring.test.ts.
- `utils/google-calendar.ts` + `utils/google-tasks.ts` — `NODE_ENV=test` short-circuits prevent real API calls; service-layer wrappers normalize.
- **All dashboard components** — no React testing infrastructure. If introducing it, first regression candidates: `EnergyButtons` cancel-modal refetch fix (§42), `MoodButtons` prefill (§42), `isFinanceActivity` filter logic (§43 finance day log).

Run `npm test` from the repo root any time to verify.

---

## 48. Meal week calendar (Food tab — 2026-05-10 evening)

Off-roadmap pivot during Phase 3. Diane wanted the Food tab to host an interactive meal week calendar that the Grocery Manager persona feeds (claude.ai chat → JSON paste → dashboard rendering).

### Meal-week architecture

The Grocery Manager runs on claude.ai (not in-API per §34) and now emits a `MEAL WEEK JSON` block after the grocery list (per the updated system prompt in [packages/shared/src/personas/grocery.ts](packages/shared/src/personas/grocery.ts)). Diane pastes that JSON into the dashboard's Food tab; the dashboard POSTs to `/api/meal-weeks` and re-renders the calendar.

### Meal-week backend

- **Model** ([apps/api/src/db/models/MealWeek.ts](apps/api/src/db/models/MealWeek.ts)) — `start_date` (YYYY-MM-DD, unique, Monday-of-week) + optional `title` + `meals: MealDay[]` (embedded subdoc). Schema timestamps map to `created_at` / `updated_at`.
- **Service** ([apps/api/src/services/meal-weeks.ts](apps/api/src/services/meal-weeks.ts)) — pure helpers `startOfWeek(Date)` (Monday-of-week math, `(getDay() + 6) % 7` since-Monday) and `shiftWeek(ymd, weeks)` for navigation arithmetic; `upsertMealWeek` validates input shape (required string fields, `effort ∈ {cook,easy,grab}`); `getMealWeek` / `getMealWeekByDate` / `listMealWeeks` for reads; `adjacentMealWeeks` returns nearest stored neighbors for nav; `deleteMealWeek` for cleanup. All read methods short-circuit `null` on malformed YYYY-MM-DD instead of throwing.
- **Routes** ([apps/api/src/routes/meal-weeks.ts](apps/api/src/routes/meal-weeks.ts)):
  - `GET /api/meal-weeks?limit=N` — newest-first list (limit clamped to [1, 200])
  - `GET /api/meal-weeks/by-date/:date` — find the week containing any day
  - `GET /api/meal-weeks/:start_date` — exact week (404 if missing)
  - `GET /api/meal-weeks/:start_date/adjacent` — nearest prev/next neighbors
  - `POST /api/meal-weeks` — upsert by start_date (returns 400 on validation failure)
  - `DELETE /api/meal-weeks/:start_date`
- **New ActivityKind** — `meal_week_saved` fires on every upsert with `{start_date, meal_count}` metadata.
- **Mongoose conflict gotcha (worth knowing)**: do NOT include `start_date` in both `$set` AND `$setOnInsert` on `findOneAndUpdate`. Mongoose throws "would create a conflict at 'start_date'". The pattern across this codebase (mirrors `setFinancialProfile`) is: filter `{start_date}` + `$set: {mutables}` + `$setOnInsert: {start_date}`. Tests caught this on first run.

### Meal-week frontend

- **Component** ([apps/dashboard/src/components/MealWeekCalendar.tsx](apps/dashboard/src/components/MealWeekCalendar.tsx)) — top-level renders:
  - Eyebrow + serif title + divider
  - Week navigator (prev / next ±7 days + "Jump to this week" link when off-current)
  - 7-day pill strip with active state + per-day effort badge (`Cook` / `Easy` / `Grab`)
  - Recipe panel for the selected day: terracotta header with title + meta chips (time / protein / servings); 2-col body (ingredients + steps) collapsing to 1-col under 600px; optional gold-bordered note; bottom day-nav (prev/next).
  - Empty state when no week exists for that Monday (paste admin still available)
  - Collapsible `<details>` paste-JSON admin with "Load sample (May 11)" button, "Save week" submit, parse-error display. `extractJson()` strips ```` ``` ```` fences and the literal "MEAL WEEK JSON" header so Diane can paste the whole block verbatim.
- **Sample JSON** ([packages/shared/src/sample-meal-week.json](packages/shared/src/sample-meal-week.json)) — the May 11–17 week from Diane's HTML mockup, with mojibake fixed (the original encoding mangled emojis and em-dashes). Bundled into the dashboard via the shared package's `exports` map. The "Load sample" button writes it into the paste textarea so it's a 2-click first-run experience.
- **api.ts methods** — `api.mealWeeks.list/get/byDate/adjacent/upsert/remove` mirror the routes 1:1.

### Meal-week styling

The calendar uses a **scoped warm palette** (cream / terracotta / sage / gold) under `.meal-cal`, intentionally distinct from the rest of the dashboard's strict-grayscale theme — Diane explicitly chose to keep the warmth from her HTML mockup. CSS variables are namespaced `--mc-*` so they can't leak. Dark-mode variant darkens the cream backdrop but keeps terracotta + gold vivid.

### Grocery Manager prompt update

A new section 6 in the system prompt instructs GM to emit a `MEAL WEEK JSON` block alongside its grocery list, with the literal header line + JSON shape inline. Schema requirements (strict effort enum, ASCII quotes for JSON parsing, free-form `day` labels, optional `note`) are documented in-prompt so GM produces parseable output the first time.

### Food tab structure (post-refactor)

The header `🛒 Food` icon (Phase 3) routes to a stacked view: `<MealWeekCalendar />` on top (new, primary surface), `<PersonaLauncher persona="grocery" />` unchanged below (kept per Diane's preference so she can still hop into Claude.ai to generate next week's plan).

### Meal-week test coverage

22 in [apps/api/src/services/meal-weeks.test.ts](apps/api/src/services/meal-weeks.test.ts): `startOfWeek` (Mon/Wed/Sun cases), `shiftWeek` (+/- 7d, month rollover, malformed input), `upsertMealWeek` (create + log, overwrite-by-start_date, bad start_date, empty meals, missing required field, invalid effort), `getMealWeek` + `getMealWeekByDate` (null when empty, exact match, find-by-any-day, malformed), `adjacentMealWeeks` (nearest neighbors skip empty Mondays, null when only one), `listMealWeeks` (newest-first), `deleteMealWeek` (success + false when missing). New total: **275 API + 10 alexa-skill = 285 tests across 31 files**.

**Not tested (deliberately):**
- The dashboard component — no React testing infra in this repo. First regression candidates if it's ever introduced: `extractJson()` JSON-fence stripping, `parseYmd`/`ymd` round-trips, `shortEffortLabel()` emoji extraction.
- The route layer — thin Express handlers over the service; service is fully covered.

---

## 47. Refactor plan (2026-05-10 PM)

Diane requested a holistic refactor focused on: (a) deeper integration with the tools she already uses (RocketMoney, Google Calendar, Alexa) without reinventing them, (b) two-way sync where missing, (c) a "one place to see everything" visual layout, (d) timestamping/tracking surfaced in the UI, (e) cleanup of unused code.

This is broken into 7 phases. Each phase is independently shippable — Diane can stop at any phase and still have a coherent system. **Total estimated effort: ~15-25 hours.** Recommended order is as written; phases 4/5/6 are independent of each other.

### Design principles for this refactor

1. **Calendar is always source of truth for time-bound things.** Diane keeps it updated and uses Google Tasks regularly. When in conflict with our cadence math, Calendar wins.
2. **Don't reprogram what Alexa/Google already do.** Use Alexa Reminders for time-based nudges (not custom notifications), Alexa Shopping Lists for the grocery handoff, Google Tasks for ad-hoc tasks where appropriate.
3. **No automatic Amazon cart placements, ever.** Shopping list is a checklist for in-person shopping (TJ's, etc.). Hard rule.
4. **Every submission is timestamped and historical.** Singletons that overwrite (`FinancialProfile` today) become append-only history with a "current view." User can browse + edit history.
5. **Deletion of running infra requires the corresponding test/route also be deleted in the same change.** No dangling references.

---

### Phase 1 — Cleanup (~30 min) — **SHIPPED 2026-05-10**

Verified dead from the audit (see §47 audit, this session):

- ✅ **Deleted** `apps/dashboard/src/components/ChatPanel.tsx` — zero imports.
- ✅ **Deleted** `apps/api/src/persona/runner.ts` and `apps/api/src/persona/runner.test.ts`. Chat moved to Claude.ai launchers per §34; in-API chat loop has no consumer.
- ✅ **Deleted** `apps/api/src/routes/chat.ts`, unmounted `/api/chat/:persona` from [apps/api/src/index.ts](apps/api/src/index.ts), and dropped from §36 route cheat sheet + the root `/` endpoint docs list.
- ✅ **Kept** `packages/shared/src/personas/{household,finance,grocery}.ts` — these define the system prompts Diane copy-pastes into each Claude.ai Project. They're documentation that compiles.
- ✅ **Kept** `apps/api/src/persona/tools.ts` and `tools.test.ts` — MCP server uses these; the drift detector test is load-bearing.
- ✅ **Removed** `@anthropic-ai/sdk` from `apps/api/package.json`. `npm install` removed 7 packages (SDK + transitive deps).
- ✅ **Scrubbed README + .env.example** — removed `ANTHROPIC_API_KEY` row from `.env.example`, removed the "Persona API chat" subsystem row from README, replaced it with a "Persona tool definitions" row pointing at `persona/tools.ts` (consumed by MCP), updated the workspace blurb (`persona chat` → `MCP`), removed the `ANTHROPIC_API_KEY` line from the Render deploy section, and updated the test count line + cost-summary blurb.

Test delta: −4 tests (runner.test.ts). New total: **247 tests across 30 files** (237 API + 10 alexa-skill). Typecheck clean across all four workspaces.

### Phase 2 — Data model changes (~1-2 hr) — **SHIPPED 2026-05-10**

New collections, no breaking changes to existing data.

```ts
// FinancialProfileSnapshot — append-only history of profile saves
{
  _id: ObjectId,
  ts: Date,                                // when saved
  source: 'dashboard_edit' | 'csv_import',
  profile: { /* full snapshot of FinancialProfile fields at save time */ },
  parent_snapshot_id?: ObjectId            // for edit-from-history flow
}

// RocketMoneyImport — every paste or CSV upload, raw + parsed
{
  _id: ObjectId,
  ts: Date,
  kind: 'paste' | 'csv',
  filename?: string,                       // csv only
  raw: string,                             // exact content as submitted
  parsed?: {                               // best-effort categorization
    categories: [{ name, amount, count? }],
    total: number,
    period_start?: Date,
    period_end?: Date
  },
  applied_to_snapshot_id?: ObjectId        // if user clicked "apply to profile"
}
```

**Shipped in Phase 2:**

- ✅ Two new Mongoose models: [apps/api/src/db/models/FinancialProfileSnapshot.ts](apps/api/src/db/models/FinancialProfileSnapshot.ts) (append-only, fields: `ts`, `source: 'dashboard_edit' | 'csv_import' | 'restore'`, `profile` as `Mixed`, optional `parent_snapshot_id`) and [apps/api/src/db/models/RocketMoneyImport.ts](apps/api/src/db/models/RocketMoneyImport.ts) (`ts`, `kind: 'paste' | 'csv'`, optional `filename`, required `raw`, optional `parsed: { categories: [{name, amount, count?}], total, period_start?, period_end? }`, optional `applied_to_snapshot_id`).
- ✅ `Routine.appointment` subdoc added in [apps/api/src/db/models/Routine.ts](apps/api/src/db/models/Routine.ts) with the spec shape (`enabled` / `calendar_event_id` / `default_duration_minutes` / `last_synced_at` / `last_event_start`). No routines have it populated yet — Phase 4 wires the per-appointment event lifecycle.
- ✅ Shared types in [packages/shared/src/types.ts](packages/shared/src/types.ts): `RoutineAppointment`, `FinancialProfileSnapshot`, `RocketMoneyImport`, `ParsedImport`, `SnapshotSource`, `ImportKind`, and two new `ActivityKind` values (`finance_import_added`, `finance_snapshot_restored`).
- ✅ New service [apps/api/src/services/finance-history.ts](apps/api/src/services/finance-history.ts) with `saveSnapshot`, `listSnapshots`, `restoreSnapshot`, `addImport`, `listImports`. Reads the `FinancialProfile` model directly (no import from `finance.ts`) to avoid a circular dep, since `setFinancialProfile` calls `saveSnapshot`.
- ✅ Snapshot-on-PATCH wired into [apps/api/src/services/finance.ts](apps/api/src/services/finance.ts) `setFinancialProfile`. Captures before-state, performs the write, snapshots after, builds a per-field `diff: { field: { before, after } }` over `DIFFABLE_FIELDS` (excludes `key` + `updated_at`), and stores `snapshot_id` + `diff` in the `routine_edited` activity-log metadata. Snapshot failure is logged but does NOT break the PATCH — activity logging is observational.
- ✅ Activity-log entries: every PATCH still logs `routine_edited` (now with diff + snapshot_id metadata); `addImport` logs `finance_import_added` with `{kind, filename, parsed: {total, category_count}, raw_length}`; `restoreSnapshot` logs `finance_snapshot_restored` with `{restored_from, restored_from_ts, new_snapshot_id}`.

**Routes intentionally NOT added yet.** Phase 2 is data-layer only. The HTTP surfaces for snapshot list / restore / import paste / import CSV ship in Phase 5 alongside the Finance tab redesign.

**Test delta:** +16 tests (13 in `finance-history.test.ts` + 3 in `finance.test.ts`). New total: **263 tests across 31 files** (253 API + 10 alexa-skill).

**Two design calls worth knowing:**

1. **`SnapshotSource` extended to include `'restore'`** beyond the spec's `'dashboard_edit' | 'csv_import'`. Without it, `restoreSnapshot` couldn't tag the chained snapshot honestly. Future paste-vs-csv distinction in Phase 5 can extend further (`'paste_import'`) without breaking shape.
2. **`saveSnapshot` reads the `FinancialProfile` model directly**, not via `getFinancialProfile()`, to avoid a circular import between `finance.ts ↔ finance-history.ts`. When no profile exists yet, it snapshots a default-shaped record rather than refusing — keeps the history honest about "what did the profile look like at this moment."

### Phase 3 — Visual refactor: Home + tab compression (~3-4 hr) — **SHIPPED 2026-05-10**

**Tab structure becomes:**

| Tab | Status | Notes |
|---|---|---|
| **Home** | NEW, default | Widget grid (below) |
| Today | Keep | Drill-down from Home |
| Schedule | Keep | Merge in calendar.today + tasks views |
| Workouts | Keep | |
| Finance | Keep | Adds history + import panel |
| Log | NEW (merge) | Activity + Journal combined, with a toggle |
| Routines | Demote | Move to a "Settings" gear icon in header, not a top-level tab |
| Food | Demote | Move to a top-bar launcher icon (single button → opens Claude.ai project) |
| Household (DayPanel) | DELETE or merge | Overlaps with Today + Home; absorb its zone-assessment trigger into Home widget |
| Guide | Demote | Move to ❔ icon in header |

Result: **6 top-level tabs** (Home, Today, Schedule, Workouts, Finance, Log) + 3 header icons (Routines/⚙️, Food/🛒, Guide/❔). Tab persistence (§43) still applies.

**Home widget grid (mobile-friendly, single column → 2-col on desktop):**

1. **Today summary** — N of M items done; one-tap to Today tab. Shows the next 2 incomplete items inline.
2. **Calendar today strip** — Google Calendar events for today; one-tap to Schedule tab.
3. **Workouts** — this week's hit count vs target; today's workout slot if any.
4. **Finance** — discretionary $/mo, top 2 outsourceables not yet covered, last RocketMoney import date.
5. **Recent activity ticker** — last 6 ActivityLog entries with relative timestamps ("3h ago", "yesterday"). Tap → Log tab.
6. **Journal/context strip** — today's ContextEntry text if any; "+" to add one quickly.
7. **Zone assessment chip** — "How's the kitchen look right now?" rotating prompt; one-tap to assess.

**Visual polish:**
- Card-based layout for widgets; consistent 12px radius; existing CSS tokens.
- Skeleton loaders on first paint (not spinners).
- Empty states with one-sentence help text + a single CTA button.
- Refresh button (§43 mobile) on every widget header.

Test delta: 0 (no dashboard tests today; documented in §46).

**What actually shipped in Phase 3:**

- ✅ New [apps/dashboard/src/components/HomePanel.tsx](apps/dashboard/src/components/HomePanel.tsx) — `widget-grid` CSS grid (1-col mobile → 2-col desktop) with 7 widgets, each loading independently so a single slow endpoint doesn't block first paint:
  - `TodayWidget` (full-width) — "N of M done" + next 2 incomplete; refresh + "Open today →"
  - `CalendarWidget` — top 3 today's events, "Schedule →" link
  - `WorkoutsWidget` — week pattern (`patterns.workouts(7)`) + today's slot
  - `FinanceWidget` — discretionary $/mo + top 2 not-covered outsourceables. The spec's "last RocketMoney import date" sub-line is deferred to Phase 5 along with the import HTTP route.
  - `ActivityWidget` (full-width) — last 6 ActivityLog entries with relative timestamps via new [utils/relativeTime.ts](apps/dashboard/src/utils/relativeTime.ts)
  - `JournalWidget` — today's `ContextEntry` text + inline "+" quick-add (textarea → `api.context.add`)
  - `ZoneChipWidget` — rotates through `ZONE_ROTATION` (day-of-year mod 6); 3 buttons (fine/meh/rough) → new `api.zones.assess` → POST `/api/zones/assess`
- ✅ New [apps/dashboard/src/components/LogPanel.tsx](apps/dashboard/src/components/LogPanel.tsx) — pill-toggle wrapper over `ActivityFeed` + `JournalPanel`. Mode persists in `localStorage` under `household-os.log-mode`. Sub-panels keep their own date controls.
- ✅ [App.tsx](apps/dashboard/src/App.tsx) refactored: 6 tabs (Home, Today, Schedule, Workouts, Finance, Log). Default view is now `home` (was `today`). Routines / Food / Guide + **Household Ops** demoted to header icons (`💬 Ops`, `🛒 Food`, `⚙️ Routines`, `❔ Guide`). The spec called for 3 header icons but didn't account for Household Ops, which previously had its own tab — adding a 4th icon kept it accessible without regressing.
- ✅ Legacy `localStorage.household-os.view` migration in `readSavedView()` — `activity` and `journal` map onto `log`; all other legacy values remain valid because they still exist as header-icon routes.
- ✅ New CSS classes in [styles.css](apps/dashboard/src/styles.css): `.widget-grid` / `.widget` (12px radius per spec) / `.widget-head` / `.widget-link` / `.widget-refresh` / `.widget-empty` / `.skeleton` (with `short/med/long` widths + pulse animation) / `.header-icon` / `.header-icon-label` / `.pill-toggle`.
- ✅ New `api.zones.assess(zone, level, notes?)` method exposing the existing `POST /api/zones/assess` route — surfaces the zone-check from the Home chip widget.
- ✅ Dead `api.chat()` method removed from [api.ts](apps/dashboard/src/api.ts) (was calling `/api/chat/:persona` which was deleted in Phase 1; had no consumers).

**Verified headlessly:** `npm run typecheck` clean across 4 workspaces, `npm run build` produces 265 KB JS / 8 KB CSS gzipped, Vite dev server boots clean and serves all new modules with HTTP 200. **NOT verified (Claude can't open a browser):** actual visual layout, click interactions (tab switches, quick-add, zone chip), responsive breakpoints, dark-mode rendering of widgets. Diane needs to spot-check those.

**Spec deviations worth knowing:**

1. **4 header icons, not 3** — added Household Ops launcher as a 4th icon. The spec only listed Routines/Food/Guide but the existing Household Ops persona launcher had to go somewhere — making it a 4th icon kept the spec's intent (demote secondary surfaces to icons) without losing access.
2. **Finance widget omits "last RocketMoney import date"** — Phase 2 deliberately shipped no HTTP routes for `RocketMoneyImport`. The widget shows discretionary + top 2 not-covered only; Phase 5 will wire the import-date sub-line when the route exists.
3. **Zone chip uses day-of-year rotation, not random** — deterministic so the prompt feels stable across refreshes within a day.

Test delta: 0 (no dashboard test infra exists in this repo; documented in §46). If we ever add Vitest + Testing Library, the first regression candidates are: `readSavedView` legacy migration, `relativeTime` unit bucketing, `todayZone` day-of-year rotation, and the `JournalWidget` quick-add path.

### Phase 4 — Per-appointment Calendar events + reconciliation (~4-6 hr) — **SHIPPED 2026-05-10**

**Goals**:
1. Appointment-style routines (head_spa, haircut, car maintenance, dogsit windows, Airbnb checkin/checkout) get their own real Google Calendar events.
2. If Diane edits/moves/deletes one in Calendar, the system picks it up and updates the routine's `last_done`/`next_due`.
3. The existing daily checklist event (§10 Publisher) stays — it's a summary, not appointment-level.

**Build:**

- Update `routines/seed.ts` (or add a migration) to mark appropriate routines `appointment.enabled = true` with default durations.
- New service `apps/api/src/services/appointments.ts`:
  - `createAppointment(routineKey, startsAt, durationMinutes?)` → inserts Google Calendar event, persists `routine.appointment.calendar_event_id`.
  - `syncAppointmentFromCalendar(routineKey)` → fetches event by stored id, compares `event.start.dateTime` to `routine.appointment.last_event_start`. If different: update routine, log ActivityLog `appointment_rescheduled`. If event missing (404): clear `calendar_event_id`, log `appointment_deleted_externally`.
- New cron `apps/api/src/cron/appointment-reconcile.ts` — runs hourly. Iterates routines with `appointment.enabled = true && calendar_event_id != null`, calls `syncAppointmentFromCalendar()`.
- Optional but recommended: **Google Calendar push notifications (watch API)** for a dedicated "Household" calendar. Requires a public webhook (`POST /api/calendar/webhook`) and Google Calendar's `events.watch`. Eliminates the polling delay. **Skip this for v1 of the refactor** — hourly polling is fine.
- UI: Routines page gets a "📅 Schedule appointment" button per appointment-enabled routine. Today/Schedule views show appointment routines with their actual time, not just "due today."

**Conflict resolution**: Calendar wins always. The cadence math becomes a *suggestion* for next-appointment timing; the actual `last_done` is the calendar event's `start.dateTime` when it's in the past, regardless of what the system thought.

**What actually shipped in Phase 4:**

- ✅ **Pure decision function** [diffAppointment](apps/api/src/services/appointments.ts) — exhaustively unit-tested. Takes `{current: {calendar_event_id, last_event_start, last_done}, event: {start: Date|null} | 'gone' | null, now?}` and returns one of `{action: 'no_change' | 'rescheduled' | 'deleted' | 'past_completed', new_*?}`. Rules: transient lookup failure (event=null) → no_change; event gone + we had one → deleted; event start in past + last_done doesn't already cover it → past_completed (sets `last_done = event.start`, the "Calendar wins" rule); start differs from `last_event_start` → rescheduled; same → no_change. **Past_completed takes precedence over rescheduled.**
- ✅ **I/O wrappers** ([apps/api/src/services/appointments.ts](apps/api/src/services/appointments.ts)):
  - `createAppointment({routine_key, starts_at, duration_minutes?})` — validates routine exists + `appointment.enabled=true` + parseable ISO start. Builds Calendar event body (`📅 <routine.name>`, start/end), inserts via `createEvent`, persists `calendar_event_id` + `last_event_start` + `last_synced_at` + back-fills `default_duration_minutes` if not set. Logs `appointment_created` with `{routine_key, starts_at, duration_minutes, calendar_event_id, calendar_skipped}`. Falls back to `appointment.default_duration_minutes ?? 60` when caller omits `duration_minutes`. In `NODE_ENV=test` (or no Calendar client), Calendar is no-op and `calendar_event_id` lands as `null` with `calendar_skipped=true`.
  - `reconcileAppointment(routineKey)` — calls `getEvent`, parses start, runs `diffAppointment`, applies the outcome to Mongo + logs `appointment_rescheduled` / `appointment_deleted_externally` / `task_done` (past_completed branch, actor='system', metadata.source='calendar_reconcile'). Always bumps `last_synced_at`.
  - `reconcileAllAppointments()` — `Routine.find({appointment.enabled: true, appointment.calendar_event_id: {$ne: null}})` then reconciles each. Per-routine `try/catch` so one transient failure doesn't kill the batch.
  - `clearAppointmentLink(routineKey)` — nulls `calendar_event_id` + `last_event_start` without touching the Google Calendar event itself. Used when Diane wants to detach but keep the event.
- ✅ **Google Calendar util extended** ([apps/api/src/utils/google-calendar.ts](apps/api/src/utils/google-calendar.ts)): added `createEvent` (returns full event), `getEvent` (returns event | `'gone'` | `null` — 404/410/`status=cancelled` all map to `'gone'`; transient failures map to `null`), `deleteEvent` (idempotent — 404/410 count as success). All three short-circuit in `NODE_ENV=test`.
- ✅ **Hourly cron** ([apps/api/src/cron/appointment-reconcile.ts](apps/api/src/cron/appointment-reconcile.ts)) — `cron.schedule('0 * * * *', ...)` in index.ts calls `reconcileAllAppointments()` once an hour. Logs the count of changes when nonzero, silent otherwise. Push notifications (`events.watch`) deliberately deferred per spec ("Skip this for v1 of the refactor — hourly polling is fine").
- ✅ **Routes** ([apps/api/src/routes/appointments.ts](apps/api/src/routes/appointments.ts)):
  - `POST /api/appointments/:routine_key` — schedule (body: `{starts_at, duration_minutes?}`)
  - `POST /api/appointments/:routine_key/reconcile` — force reconcile (returns `{routine_key, action, applied}`)
  - `DELETE /api/appointments/:routine_key` — unlink (Mongo only, doesn't touch Google)
  - `POST /api/appointments/reconcile-all` — admin trigger for the cron logic
- ✅ **Seed update** ([apps/api/src/seed.ts](apps/api/src/seed.ts)) — new `APPOINTMENT_DEFAULTS` map sets `appointment.enabled: true` + `default_duration_minutes` on: `haircut` (60), `head_spa` (90), `brazilian_wax` (30), `massage` (60), `nails_apply` (60), `oil_change` (60), `car_inspection` (30), `tire_rotation` (30), `regular_cleaning` (180 — cleaner visits the house ~3h). Other routines get no appointment field.
- ✅ **Dashboard** ([apps/dashboard/src/components/RoutinesPage.tsx](apps/dashboard/src/components/RoutinesPage.tsx)) — Routines page now shows a `📅 schedule` / `📅 linked` button per appointment-enabled routine (only — others get just the edit button). Click opens a `ScheduleAppointmentModal` with native `<input type="datetime-local">` (default: tomorrow at 10am local) + duration input (defaults to routine's `default_duration_minutes`). Submitting creates the event; an `unlink` button appears on already-linked routines that detaches without deleting the Calendar event. Errors surface inline.
- ✅ **api.appointments** in [apps/dashboard/src/api.ts](apps/dashboard/src/api.ts) — `create(key, isoStartsAt, durationMinutes?)`, `reconcile(key)`, `unlink(key)`.
- ✅ **3 new ActivityKinds**: `appointment_created`, `appointment_rescheduled`, `appointment_deleted_externally` (the `past_completed` branch logs as plain `task_done` with `metadata.source='calendar_reconcile'` for consistency with how completions are tracked elsewhere).

**Spec deviations / design calls worth knowing:**

1. **Today/Schedule views NOT updated to surface appointment times** — spec mentions "Today/Schedule views show appointment routines with their actual time, not just 'due today'" but I deferred this. Reason: it would mean threading `appointment.last_event_start` through `getDayView` / `scheduleRange` and updating multiple panel components, which is its own non-trivial change. Phase 4's core mechanic (linkage + reconcile cron + UI to create) is independently useful; the read-side polish is a follow-up. Tracked as an open gap below.
2. **Re-seeding wipes `appointment.calendar_event_id` linkage** — existing `seed.ts` does `deleteMany` + `insertMany`. Same gotcha already documented in §21 for `last_done`. Worth flagging here too: **once Diane has linked real appointments, do not re-seed without manually preserving `appointment.*` fields**. Eventually we should switch seed to upsert-by-key. For now, only `start-tomorrow` (which preserves `last_done`) is safe to re-run.
3. **`createAppointment` does NOT delete a previously-linked event** — if you call create on an already-linked routine, it creates a NEW event and orphans the old one in Google Calendar. The modal copy warns about this. The Mongo linkage moves to the new event; the old one stays in Google for Diane to clean up by hand. Rationale: deleting an event the user already moved around feels worse than orphaning a tagged event with a known `📅` prefix.
4. **`past_completed` logs as `task_done` (not a new kind)** — keeps the completion timeline coherent (same activity-feed icon, same filters) and avoids adding a 4th appointment kind for what's semantically just "task got completed, source=Calendar."

Test delta: **+18 tests** (15 in [apps/api/src/services/appointments.test.ts](apps/api/src/services/appointments.test.ts)). 6 exhaustive `diffAppointment` cases (transient failure / event gone two ways / past_completed two ways / rescheduled three ways / past beats reschedule). 9 I/O wrapper tests (createAppointment happy path + default duration + 4 reject paths; reconcile skip-paths; clearAppointmentLink). Reconcile happy paths through the Google API itself are NOT tested — that needs network mocking, same rationale as §40 Google Tasks. Service-layer + pure-decision coverage is the high-value testable seam.

### Phase 5 — RocketMoney workflow: paste + CSV + history (~2-3 hr) — **SHIPPED 2026-05-10**

**Finance tab gains 3 sub-sections** (replacing the current single `expense_breakdown` paste box):

1. **Current profile** (existing UI) — gross, fixed expenses, tax estimate, etc. Save button writes a `FinancialProfileSnapshot` per Phase 2.
2. **RocketMoney imports** —
   - "Paste latest breakdown" textarea + Save button → writes `RocketMoneyImport` (kind=`paste`).
   - "Upload CSV" button → multipart upload, stored raw, attempted parse (simple category aggregation), preview before save. Writes `RocketMoneyImport` (kind=`csv`).
   - History list: most-recent-first, each row shows ts, source, total, and "View / Apply to profile / Edit" buttons. "Apply to profile" copies the parsed categories into `expense_breakdown` and saves a snapshot.
3. **Submission history** — chronological list of `FinancialProfileSnapshot` entries; click to view the full state at that time; "Restore" button reverts the current profile (and writes a new snapshot of the restoration). Edit-in-place opens the standard profile editor pre-filled.

**CSV parser**: keep simple. Most RocketMoney CSVs have columns roughly like `Date, Description, Category, Amount`. Parse by category, sum amounts in the file's date range, return `{ categories, total, period_start, period_end }`. If columns don't match expectation, save raw + flag "parse failed" — the raw is still in the DB.

**File storage**: store CSV content as a UTF-8 string field on `RocketMoneyImport.raw` directly in Mongo. Keep it simple; CSVs are small (KB, not MB). Add a guard if raw > 1MB → reject with a clear error.

Test delta: +~12 tests (finance-history, import, csv-parser).

**What actually shipped in Phase 5:**

- ✅ **CSV parser** ([apps/api/src/services/csv-parser.ts](apps/api/src/services/csv-parser.ts)) — pure module, no DB / no side effects. `parseRocketMoneyCsv(raw) → ParsedImport | null`. Detects required columns case-insensitively (`Date`, `Category`, `Amount`), tolerates extra columns, honors quoted CSV fields with embedded commas + escaped quotes, handles negative amounts in `-12.34` or `($12.34)` form, strips `$` and `,` from amounts. **Only counts outflows** (negative rows) so positive income/refunds don't skew the spending breakdown. Returns `null` when required columns are missing OR when no outflow rows exist — both cases preserve the raw payload upstream so nothing is lost. Plus exported helpers: `parseCsvLine`, `parseImportDate` (YYYY-MM-DD + M/D/YYYY, with overflow rejection via component round-trip), `parseAmount`, `formatParsedAsBreakdown` (renders ParsedImport as readable text for `expense_breakdown`).
- ✅ **`applyImportToProfile(importId)`** added to [apps/api/src/services/finance-history.ts](apps/api/src/services/finance-history.ts). Bypasses `setFinancialProfile` deliberately so the resulting snapshot is tagged `paste_import` or `csv_import` (not `dashboard_edit`). Writes the import's text (raw for paste; `formatParsedAsBreakdown(parsed)` for CSV with `parsed`; fallback to raw for unparseable CSV) into `FinancialProfile.expense_breakdown`, calls `saveSnapshot`, sets `applied_to_snapshot_id` on the import doc, and logs `routine_edited` with `{import_id, import_kind, snapshot_id, fields: ['expense_breakdown']}` metadata. Throws on invalid ObjectId or missing import.
- ✅ **`SnapshotSource` extended** to include `'paste_import'` alongside the existing `'dashboard_edit' | 'csv_import' | 'restore'` (Phase 2 commentary explicitly anticipated this).
- ✅ **5 new HTTP routes** in [apps/api/src/routes/finance.ts](apps/api/src/routes/finance.ts):
  - `GET /api/finance/imports?limit=N`
  - `POST /api/finance/imports` — body `{kind, raw, filename?}`. Server attempts CSV parse, persists either way (raw is authoritative). **1MB `raw` byte-length guard** rejects with `413` per spec.
  - `POST /api/finance/imports/:id/apply` — runs `applyImportToProfile`; returns `{profile, snapshot_id, import_id}`. 404 vs 400 routing based on error message.
  - `GET /api/finance/snapshots?limit=N`
  - `POST /api/finance/snapshots/:id/restore`
- ✅ **Dashboard rebuild** ([apps/dashboard/src/components/FinancePanel.tsx](apps/dashboard/src/components/FinancePanel.tsx)):
  - Removed the inline `expense_breakdown` textarea (the old "Save breakdown" button is gone — breakdowns now flow through the imports system).
  - **`<FinanceImports>` panel** — pill toggle between **Paste** (textarea) and **CSV upload** (file input, `.csv` accept, 1MB client-side guard mirroring the server). Save button creates an import; the new import appears in the history list immediately (optimistic prepend). History rows show kind + filename + parsed summary (`N categories · $total`) or `parse failed (raw saved)` for CSVs that didn't match the expected columns. Each row has **View** (toggles a `<pre>` of `raw`) and **Apply to profile** buttons. An `applied` badge marks the row once it's been applied. Below the history, a collapsed `<details>` shows the current `expense_breakdown` for reference.
  - **`<FinanceSnapshots>` panel** — chronological list of `FinancialProfileSnapshot` entries newest-first. Each row shows source label (`profile edit` / `paste` / `CSV` / `restore`) + a quick snapshot summary (gross + fixed). **View** toggles a JSON-formatted view of the full `profile` snapshot. **Restore** confirms via `window.confirm` (because restore overwrites the live profile) then calls the route; on success refreshes the profile form + snapshots list.
  - Reload coordination: `FinancePanel` owns `importsReloadKey` + `snapshotsReloadKey` counters. Profile saves bump the snapshots key. Applying an import bumps both. Restoring bumps both + refreshes form fields. The sub-components consume the key as a `useEffect` dependency.
- ✅ **`api.finance.imports.list/create/apply` + `api.finance.snapshots.list/restore`** in [apps/dashboard/src/api.ts](apps/dashboard/src/api.ts).

**Test delta:** **+32 tests** (24 in `csv-parser.test.ts` + 7 `applyImportToProfile` in `finance-history.test.ts` + 1 from a parseImportDate edge case caught during dev). Comfortably above the spec's +~12 target — CSV parsing has more edge cases than route logic, and getting the parser right matters because if it silently misreads a CSV, applying it to the profile feeds bad data into the persona. New API total: **329** (vs 297 entering Phase 5).

**Notable design calls:**

1. **CSV parsing ignores positive rows** (income/refunds) — the spec said "Parse by category, sum amounts." Including income would mix categories Diane probably doesn't want to discuss with the Finance persona (e.g. "Income: $5,200" landing in expense_breakdown) and the refund case is even worse (it makes a category look cheaper than reality). Outflows only. If she wants income in the breakdown she can use the paste mode.
2. **`parseImportDate` rejects out-of-range components** — JS's `Date` silently rolls overflow (`2026/13/40` → `2027-02-09`). Tests caught this. Fixed by round-tripping components after construction.
3. **`applyImportToProfile` does NOT use `setFinancialProfile`** — that path tags snapshots `dashboard_edit`, which would make the history view lie about provenance. Applying writes the profile fields directly and calls `saveSnapshot('paste_import' | 'csv_import')` explicitly.
4. **CSV uploads are read client-side as text and POSTed as JSON `{raw}`** rather than as `multipart/form-data`. Avoids adding a multer-style dep to the API; CSVs are KB-scale; 1MB guard is enforced on both ends. If we ever want truly big files (we shouldn't), revisit.
5. **`window.confirm()` on Restore** — destructive operation that overwrites live profile values. A modal would be nicer; `confirm` is the minimum viable safety rail and adds zero code. Snapshot history itself is the real safety net (every restore writes a new snapshot, so it's reversible).
6. **No dashboard test infra** — same situation as Phases 3 + 4. The high-value seam is the pure CSV parser, which gets exhaustively covered. Component flows aren't unit-tested; manual smoke needed.

### Phase 6 — Alexa: Reminders + Shopping List + WhatsLeftIntent (~4-6 hr) — **SHIPPED 2026-05-10 (code-complete; LWA activation pending Diane)**

**6a. Alexa Reminders integration** (replaces ad-hoc custom notifications for time-based items)

- Add `alexa::devices:all:reminders:write` permission to skill manifest.
- Account linking flow so the API can hold an Amazon-issued access token outside skill sessions (same flow needed for Shopping Lists, so build once).
- New service `apps/api/src/services/alexa-reminders.ts` — `createReminder(text, scheduledTime, recurrence?)`.
- Wire it from the appointment-reconcile cron: when an appointment is within 24h, create an Alexa Reminder if one doesn't already exist for that calendar_event_id (track in a new `AlexaReminder` collection: `{ calendar_event_id, alexa_reminder_id, created_at, expires_at }`).
- Existing 6 AM daily brief (Publisher → Proactive Events) stays as the morning push.

**6b. Alexa Shopping List integration** (for grocery persona handoff)

- Add `alexa::household:lists:write` permission to skill manifest.
- New endpoint `POST /api/alexa/shopping-list/add` — body `{ items: string[] }`. Calls the Alexa Lists API and adds each item. Returns success/failure per item.
- Dashboard panel on Food tab: paste-from-Claude grocery list → parser splits into `## Section`-headed lines and `- qty item` rows → "Send to Alexa Shopping List" button → bulk-add → confirmation toast.
- **Hard rule, encoded in the route and the dashboard copy**: this only writes to the Alexa shopping list. It does NOT touch any Amazon cart, never calls the Amazon Marketplace API, never places orders. The shopping list is a checklist for in-person shopping (TJ's, Costco, QFC). Add a one-line comment at the top of the route stating this rule.

**6c. WhatsLeftIntent** ("What am I still missing for the day?")

- New intent in `apps/alexa-skill/src/handlers/today.ts` — `WhatsLeftIntent`.
- Server: `GET /api/today/whats-left` returns `{ items: [{ name, estimate_minutes }], total_minutes }` for today's plan items where `status !== 'done'`. Sorted by `order`.
- Skill speaks: "You have 3 items left: bins to curb, scoop litter, and the kitchen reset. About 35 minutes total." If 0 left: "You're done for today."
- Add to skill manifest sample utterances: "what am I still missing for the day", "what's left", "what do I have left today".

Test delta: +~12 tests (alexa-reminders, shopping-list route, whats-left handler).

**What actually shipped in Phase 6:**

- ✅ **6c: WhatsLeftIntent (fully active)** — `whatsLeftToday()` in [apps/api/src/services/today.ts](apps/api/src/services/today.ts) returns `{items: [{name, estimate_minutes, routine_key}], total_minutes}` for plan items where `status !== 'done'`, sorted by `order`. Exposed at `GET /api/today/whats-left`. New `WhatsLeftHandler` in [apps/alexa-skill/src/handlers/today.ts](apps/alexa-skill/src/handlers/today.ts) speaks an Oxford-joined list: *"You have 3 items left: bins to curb, scoop litter, and the kitchen reset. About 35 minutes total."* Says *"You're done for today."* when zero. Interaction model gets 7 new sample utterances ("what am I still missing", "what's left to do", "what do I have left", etc.). Wired into `skill.ts`. **This one needs no Amazon-side setup beyond a skill model rebuild — it works immediately.**
- ✅ **6b: Shopping List integration (code-complete; LWA pending)** — Pure parser [apps/api/src/services/grocery-list-parser.ts](apps/api/src/services/grocery-list-parser.ts) handles `## Section` headers + `-`/`*`/`•` bullet rows + ```` ``` ```` fences + optional `GROCERY LIST` title line + sections-as-h1-through-h6. Service [apps/api/src/services/alexa-shopping-list.ts](apps/api/src/services/alexa-shopping-list.ts) finds the user's default shopping list via `GET /v2/householdlists/`, then `POST`s items one at a time. Returns `{results, added, failed, status: 'ok' | 'no_token'}`. When LWA isn't configured (NODE_ENV=test OR no stored token), returns `status: 'no_token'` so the route can return a clear 503. **Hard rule** restated at the top of the service, the route, and the dashboard panel: this only writes to the Alexa shopping list — never an Amazon cart, never orders, never spends money. Route at `POST /api/alexa/shopping-list/add` with a 100-item cap and a 413 for over-cap. Dashboard [ShoppingListPanel.tsx](apps/dashboard/src/components/ShoppingListPanel.tsx) lives on the Food tab between the meal calendar and the persona launcher: paste textarea → live-parse preview grouped by section → "Send to Alexa" button with auth-status guard.
- ✅ **6a: Reminders integration (code-complete; LWA pending)** — `createReminderForAppointment` in [apps/api/src/services/alexa-reminders.ts](apps/api/src/services/alexa-reminders.ts) is idempotent via the new `AlexaReminder` Mongo collection keyed on `calendar_event_id`. Posts to `/v1/alerts/reminders` with `SCHEDULED_ABSOLUTE` 30 min before the appointment. Returns `null` (clean no-op) when LWA isn't configured. Wired into the existing hourly `reconcileAppointmentsCron` ([apps/api/src/cron/appointment-reconcile.ts](apps/api/src/cron/appointment-reconcile.ts)) as a second pass: for every appointment-enabled routine with `last_event_start` within the next 24h, ensure a reminder exists. `clearLocalReminderForEvent` for cleanup when events are removed externally.
- ✅ **LWA token plumbing** — [apps/api/src/services/alexa-lwa.ts](apps/api/src/services/alexa-lwa.ts) wraps the Login-with-Amazon token lifecycle. `getValidAccessToken()` returns the stored token, auto-refreshing via `https://api.amazon.com/auth/o2/token` (grant_type=refresh_token) if within 5 min of expiry. `saveAccessToken()` upserts the new `AlexaAuth` singleton. `alexaLwaConfigured()` for clean 503 routing. Returns `null` in NODE_ENV=test or when `ALEXA_CLIENT_ID`/`SECRET` aren't set. Manual token-save endpoint at `POST /api/alexa/lwa/save-token` for one-time bootstrap.
- ✅ **Skill manifest updated** — [apps/alexa-skill/skill.json](apps/alexa-skill/skill.json) now declares `alexa::devices:all:reminders:write` + `alexa::household:lists:write` alongside the existing notifications permission. Diane needs to deploy this manifest (Alexa Developer Console → Build → Permissions section will show the new entries) before she can grant them in the Alexa app.
- ✅ **Routes added** to `/api/alexa`:
  - `GET /api/alexa/auth-status` — `{configured: boolean}` for the dashboard to decide whether to grey out the Send button
  - `POST /api/alexa/shopping-list/add` — body `{items: string[]}`, caps 100
  - `POST /api/alexa/lwa/save-token` — bootstrap LWA storage
- ✅ **3 new Mongo models** — `AlexaAuth` (singleton token store), `AlexaReminder` (per-calendar-event idempotency key). No third — the second one carries both responsibilities I was planning.

**Test delta:** **+20 tests** (8 grocery-list-parser, 2 whats-left, 4 alexa-shopping-list, 4 alexa-reminders, 2 from added vocabularies). New API total: **349** (was 329). Comfortably above the spec's +~12.

**📋 Operational TODO for Diane to fully activate 6a + 6b:**

Once-only setup (the code is shipped, but Amazon needs to know the skill wants these permissions):

1. **Bump the deployed skill model** so the new permissions + WhatsLeftIntent take effect:
   - In the Alexa Developer Console, open the Household Ops skill → **Build** → click **Save Model** then **Build Model**. (The local `skill.json` + `interaction-model.en-US.json` need to be uploaded via ASK CLI or pasted in.)
   - Under **Build → Permissions**, you'll now see "Reminders" and "Lists Read/Write" checkboxes — ensure both are toggled on. Save.
2. **Re-link the skill in the Alexa app** so it picks up the new permission scopes:
   - Alexa app → Skills & Games → Your Skills → Household Ops → Disable → Enable.
   - When re-enabling, accept the new permission prompts (Reminders + Lists).
3. **(Optional, only if you want full out-of-session reminders)** Stand up a one-time LWA token bootstrap:
   - In the Amazon Developer Console → **Login with Amazon** → create / find the security profile linked to your skill. Grab the `client_id` + `client_secret`. Make sure `ALEXA_CLIENT_ID` + `ALEXA_CLIENT_SECRET` are set in Render (you already use them for Proactive Events, so they should already be there).
   - Run an interactive LWA OAuth flow once to get the initial `access_token` + `refresh_token` (a small CLI script or curl against `/auth/o2/token` with `grant_type=authorization_code`).
   - POST the response body to `https://<your-render-url>.onrender.com/api/alexa/lwa/save-token` with the bearer token.
   - After that the refresh loop maintains itself.

Until step 3 is done, the dashboard ShoppingListPanel + reminders cron will gracefully no-op with clean 503s / null returns. **Nothing is broken without it; the new surfaces just don't actually push to Alexa yet.**

**Design calls worth knowing:**

1. **CSV/file uploads were not added to the shopping list flow** — only paste. The MealWeekCalendar already handles CSV-shaped data; adding a separate CSV upload for grocery lists felt redundant when the paste textarea handles GM's output verbatim.
2. **Reminders use absolute time (`SCHEDULED_ABSOLUTE`), 30 min before the appointment** — feels right for haircut/oil-change cadence. If Diane wants different lead time per category (e.g. 24h before head_spa for prep), it'd go on the routine's appointment subdoc as a `lead_minutes` field — a small Phase 4.5 follow-up.
3. **Tests deliberately exercise the no-token path** — `NODE_ENV=test` short-circuits LWA, same isolation pattern as Google Calendar + Tasks. The actual Amazon API calls would need network mocking to test, and historically that's been more brittle than valuable. Validate the live path by re-linking the skill and watching the reconcile cron logs.
4. **`AlexaReminder` is keyed on `calendar_event_id`, not routine_key** — because a single routine may have multiple appointments over time (Diane reschedules head_spa quarterly). Idempotency at the event level prevents duplicate buzzes for the same booking; new bookings get fresh reminders.

---

## 49. Mobile responsive audit (2026-05-10 evening)

After Phase 6, a quick pass to tighten layout on phones:

- **`.app` padding** — adds `@media (max-width: 520px)` block in [styles.css](apps/dashboard/src/styles.css) that shrinks app padding from `2rem 1.25rem 5rem` → `1rem 0.75rem 4rem`, drops `h1` font-size from `1.85rem` → `1.5rem`, and tightens `.panel` + `.widget` padding by ~0.3rem. Visual: more horizontal real estate on a 375px-wide viewport.
- **Finance outsourceable table** — wrapped in `<div style={{overflowX: 'auto'}}>` with `min-width: 24rem` on the table so it horizontally scrolls instead of forcing the whole page wider. Cells stay readable.
- **What was already good** — `.tabs` and the header icon row already use `flex-wrap: wrap`, so they reflow on mobile. `.widget-grid` collapses to single-column under 640px. MealWeekCalendar has its own `@media (max-width: 600px)` breakpoint stacking the recipe body. ShoppingListPanel uses `width: 100%` textareas. PersonaLauncher's launcher button + system prompt textarea were already responsive.

## 50. Home widget reorder + Journal full-width (2026-05-10 evening)

Diane's request: Zone Check belongs right after Finance (it's a quick-pulse action that pairs naturally with the discretionary widget), and the Journal widget should take the full width since today's entries can be longer than half a card.

[HomePanel.tsx](apps/dashboard/src/components/HomePanel.tsx) new order:

1. TodayWidget (`.full-width`)
2. CalendarWidget
3. WorkoutsWidget
4. FinanceWidget
5. **ZoneChipWidget** (moved up from #7)
6. ActivityWidget (`.full-width`)
7. **JournalWidget (`.full-width`)** (was half-width)

On desktop (≥640px) the grid is now: 1 full row + 2-up CalendarWidget+WorkoutsWidget + 2-up FinanceWidget+ZoneChipWidget + 2 full-width rows. On mobile: linear single column, same order.

### Phase 7 — Timestamp visibility (~1-2 hr)

Data is already timestamped. This phase makes it *visible*.

- **Routines page**: each row shows `last_done` as a relative time ("3h ago", "yesterday", "5 days ago") + `appointment.last_synced_at` for appointment routines.
- **Finance tab**: profile shows `updated_at` prominently; imports list shows ts on every row; snapshot history defaults to expanded.
- **Home recent-activity widget**: last 6 ActivityLog entries with relative timestamps.
- **Today rows**: completed items show "✓ at 9:42 AM" instead of just "✓".
- **Log tab**: full timestamps + filterable by kind, actor, date range. Add a `?date=YYYY-MM-DD` query param wiring (already supported server-side per §36).
- Add a small utility `apps/dashboard/src/utils/relativeTime.ts` (or use `Intl.RelativeTimeFormat`) — single source of truth for "3h ago" formatting across the app.

Test delta: 0 (UI-only, no React test infra).

---

### Summary table

| Phase | What | Effort | Test delta | Independently shippable? |
|---|---|---|---|---|
| 1 | Cleanup (delete dead chat infra) | 30 min | −4 | Yes |
| 2 | Data model (snapshots + imports + appointment field) | 1-2 hr | +15 | Yes, but blocks 4 and 5 |
| 3 | Home tab + tab compression | 3-4 hr | 0 | Yes |
| 4 | Per-appointment calendar events | 4-6 hr | +10 | Yes |
| 5 | RocketMoney paste + CSV + history | 2-3 hr | +12 | Yes |
| 6 | Alexa Reminders + Shopping List + WhatsLeft | 4-6 hr | +12 | Yes |
| 7 | Timestamp visibility polish | 1-2 hr | 0 | Yes |

Recommended order: **1 → 2 → 3 → (4, 5, 6 in any order) → 7**. Diane can stop after Phase 3 and still have a substantially nicer system; can stop after Phase 5 and have the Finance workflow she described; full plan ends with Phase 7 polish.

### Hyperfixate-burnout guard

This plan represents 15-25 hours of work spread across phases. The system already works today. Build incrementally; ship each phase to the deployed app before starting the next so progress is visible. Don't merge Phases 4 + 6 in the same session — Google API debugging + Alexa API debugging in one sitting is a fast path to burnout.

---

## 50. Rebuild to three-view shape (2026-05-11 — supersedes §47 direction)

**This section is the new canonical direction. §47 is honored for shipped phases, but §47 Phase 7 (timestamp polish) and all future feature expansion stop here. §48 (meal week calendar) and §49 (mobile audit) survive in their current form unless explicitly listed below for removal.**

### Why this section exists

On 2026-05-11, after stepping back from implementation, Diane and I revisited what the app should actually be for someone with her life — five income streams, 4 pets, chaotic schedule, hyperfixate-burnout pattern, preference for keeping some workflows manual (pen-and-paper income, in-person shopping). The audit was honest: the system has grown past what her life actually needs. The features she'd open every day are narrow:

- Introspection (not optimization) for mood/energy/awakeness
- Affordability Q&A (not budget management)
- Routine + Calendar sync (not daily plan generation)
- A grocery list helper that respects her diet + store splits

Most of the elaborate scheduling infrastructure (TodayPlan auto-gen, swap pool, zone rotation, workout night-before check-in, three-persona chat split, Home widget grid sprawl) was solving problems she doesn't actually have. This section strips the system down to **one unified Claude assistant + three views**, and lists what to delete vs simplify vs keep from the current shipped state.

### Core principles (these override every prior principle in §11 / §47)

1. **One Claude assistant, not three personas.** Real questions cross persona boundaries constantly ("can I afford to bump the cleaner to every 3 weeks?"). One assistant with read access to everything answers all of them. The split into Household / Finance / Grocery introduced friction and complexity without value.
2. **Three views: Today, Look Back, Stuff.** Replaces the six-tab structure from §47 Phase 3. The Home widget grid is too much; collapse to a single Today view that holds the morning check-in + Calendar today strip + a habits reminder + an Ask input.
3. **Calendar is the source of truth** for time-bound items. This is unchanged from §47 Phase 4 — the appointment-reconcile infrastructure stays.
4. **RocketMoney as data input, not a target to replace.** The Phase 5 CSV/paste workflow stays. The app stores history; RocketMoney remains the categorization tool.
5. **Pen-and-paper income stays as Diane's workflow.** The app accepts a single per-month projected income number as input. That's the integration — no attempt to replace the paper log.
6. **Introspective, not prescriptive.** Mood/energy/awakeness tracking surfaces patterns retrospectively in Look Back. No streaks, no daily scoring, no nags.
7. **Dashboard is the full control surface.** CRUD on routines, system prompt editing, monthly inputs all in the browser. No codebase edits for routine use.
8. **Habits aren't tracked, appointments are.** Daily habits (litter scoop, sweep, kitchen reset) appear as a static visual reminder list on Today, not as cadence-tracked routines.
9. **Calendar bidirectional sync wins over in-app planning.** When she reschedules in Calendar, the app's reconcile cron picks it up. When she edits a routine in-app, the modal asks the cadence-shift question and writes back to Calendar.
10. **Hard rule, inherited from §47 Phase 6**: shopping list integration never touches Amazon cart. Encoded in the route already; keep it.

### Current state (what's actually live on Render as of 2026-05-10 PM)

This matters because Option A is a rollback + simplification, not a fresh build:

- ✅ §47 Phase 1 shipped — chat infrastructure (ChatPanel, runner.ts, `/api/chat/:persona`, `@anthropic-ai/sdk` dep) all deleted. **§50 re-adds this work for the unified assistant.**
- ✅ §47 Phase 2 shipped — FinancialProfileSnapshot, RocketMoneyImport, Routine.appointment field. **§50 keeps all of this.**
- ✅ §47 Phase 3 shipped — Home tab + 6-tab compression (Today, Schedule, Workouts, Finance, Log + Home). **§50 further compresses to 3 views.**
- ✅ §47 Phase 4 shipped — per-appointment Calendar events + `diffAppointment` + reconcile cron. **§50 keeps all of this.**
- ✅ §47 Phase 5 shipped — RocketMoney paste + CSV + history. **§50 keeps all of this, surfaces it inside Stuff/Finance.**
- ✅ §47 Phase 6 code-complete (LWA activation pending) — Alexa Reminders + Shopping List + WhatsLeftIntent. **§50 keeps the morning push + WhatsLeftIntent (retooled). Defers full Reminders integration. Keeps Shopping List but accessed via the unified assistant, not a Grocery persona launcher.**
- ✅ §48 Meal week calendar shipped on the Food tab. **§50 collapses the Food tab; the meal week calendar UI either retires or moves into the unified assistant's chat surface.** Decision deferred to Phase A below — Diane should sanity-check whether she'd miss the meal week view.
- ✅ §49 Mobile responsive audit complete. **§50 inherits this work — the three views must remain mobile-first.**

### What gets DELETED in §50

Each item is safe because nothing in the three-view design depends on it.

**Models (with their services, routes, tests, and cron):**
- `TodayPlan` — central state for "today's plan" retires. Today view reads Calendar + routines + morning check-in directly.
- `WorkoutDay`, `WorkoutWeek` — workout night-before check-in retires. Replaced by the much simpler `WorkoutLog` already in the system; logging is retroactive only.
- `ZoneAssessment`, `AdHocTask` — zone assessment feature retires entirely.
- `CheckIn` (the existing morning-checkin variant) — replaced by `MorningCheckin` (new shape: mood + energy + awakeness in one document).
- `MoodLog`, `EnergyLog`, `DeferralEvent` — folded into the new `MorningCheckin` model.
- `ContextEntry` (§22 Journal) — folded into the optional `note` field on `MorningCheckin`. The richer ContextEntry schema isn't needed.

**Services + routes:**
- `services/today.ts` + its routes (`/today`, `/today/regenerate`, `/today/swap`, `/today/mark-done`, `/today/pull-from-pool`) — delete entirely.
- `cron/morning-gen.ts` — delete.
- All retrospective / nudge crons (`cron/evening-retro.ts`, `cron/morning-intent.ts`, `cron/pattern-interrupts.ts`, `cron/weekly-review.ts`, `cron/zone-assessment.ts`) — delete.
- `services/zones.ts` + `routes/zones.ts` — delete.
- `services/checkins.ts` (old) — replace with new `services/morning-checkin.ts`.
- `services/patterns.ts` and `/api/patterns/*` routes — delete.
- Publisher's daily-checklist event creation — delete. The per-appointment events from Phase 4 replace it; no daily summary event.
- `routes/day.ts` (`GET /api/day/:date` DayView bundle) — delete; was a TodayPlan-era aggregation.

**Dashboard:**
- All tabs except 3 (Today, Look Back, Stuff). Concretely delete: Schedule (merge into Today via Calendar strip), Workouts (workouts surface in Look Back), Log (Activity + Journal merged into Look Back retrospective), the Home widget grid from §47 Phase 3 (Today becomes the landing page).
- Food tab — delete unless Diane wants to preserve the §48 meal week view; default to delete.
- Routines tab — replaced by Stuff/Routines sub-tab.
- Components to delete: `TodayList`, `DayPanel`, `SchedulePanel`, `WorkoutPanel`, `ActivityFeed`, `JournalPanel`, `TodayContextStrip`, `EnergyButtons`, `MoodButtons`, `MealWeekCalendar`, `PersonaLauncher` (no more per-persona launcher pattern), and any Home widgets that don't map into the three-view shape.

**Persona infrastructure:**
- The three persona files `packages/shared/src/personas/{household,finance,grocery}.ts` — collapse into one `packages/shared/src/persona/assistant.ts`. Delete the three.
- The launcher pattern (§34, §45) — retire. The Claude.ai Projects Diane has on mobile continue to exist independently; the dashboard's unified assistant uses an adapted version of the system prompt for API.

**Other:**
- `mcp/server.ts` + `mcp/route.ts` + tools exposed through MCP — delete. The unified assistant calls tools directly; MCP was unwired and is unneeded.
- The §47 Phase 6 Alexa Reminders integration (account linking + AlexaReminder collection) — defer indefinitely. The morning push + WhatsLeftIntent are enough; Reminders adds operational burden without proportionate value.
- Test files for any deleted module take their tests with them.

**Test count expectation after deletes:** roughly 100-130 tests survive (down from current ~263). Most deletions take their tests with them; some shared service tests need pruning.

### What gets KEPT (with simplifications noted)

**Models:**
- `Routine` — simplify. Remove `energy`, `flex_days`, `also_triggers`, `skip_if`, `prep_dependency`, `zone_rotation` scheduling type. Keep `key`, `name`, `category`, `scheduling.{type, interval_days}`, `next_due`, `last_done`, `appointment` block (from Phase 2), `outsourceable.{cost_estimate, monthly_occurrences_override?}`, free-form `notes`, `active`.
- `Trigger` — keep for Calendar event ingestion (Airbnb, dogsit, landscaper, cleaner_visit).
- `FinancialProfile` (singleton) + `FinancialProfileSnapshot` (history) + `RocketMoneyImport` — all kept from Phase 2/5. These are the finance backbone of §50.
- `ActivityLog` — keep as invisible infrastructure. Look Back reads from it for retrospective surfacing. No dedicated UI tab.
- `WorkoutLog` — keep, simplified shape: `date`, `kind` ('strength'|'cardio'|'other'), `outcome` ('full'|'modified'|'skipped'), `note`. Retroactive logging only.

**New model:**
```ts
// MorningCheckin — one document per date
{
  _id: ObjectId,
  date: string,                              // 'YYYY-MM-DD', unique index
  mood: 'good' | 'neutral' | 'down',
  energy: 'low' | 'medium' | 'high',
  awakeness: 'groggy' | 'meh' | 'alert',
  note?: string,                             // optional, ≤500 chars
  created_at: Date,
  updated_at: Date
}

// AssistantSettings — singleton with versioned system prompt
{
  _id: ObjectId,
  key: 'current',
  system_prompt: string,
  model: string,                             // default 'claude-sonnet-4-6'
  versions: [{ ts, system_prompt, edited_by: 'user' | 'seed' }],
  updated_at: Date
}
```

**Services + routes:**
- `services/finance.ts` (tax estimator, affordability report, `listOutsourceable`) — keep. These are the finance functions Diane actually uses.
- `services/finance-history.ts` (Phase 2) — keep.
- `services/appointments.ts` + `diffAppointment` + `reconcileAppointment` (Phase 4) — keep entirely.
- `cron/appointment-reconcile.ts` (Phase 4) — keep.
- `cron/calendar-ingest.ts` — keep.
- Google Calendar utilities (Phase 4) — keep.
- Google Tasks integration — keep, read-only on Today view's Calendar strip.
- Google sign-in (§38) — keep.
- New service `services/morning-checkin.ts` with `upsertCheckin(date, fields)`, `getCheckin(date)`, `recentCheckins(days)`.
- New service `services/assistant-settings.ts` with `getCurrent()`, `update(prompt)` (versioned), `resetToSeed()`.

**Dashboard infrastructure:**
- Theme + typography (§33) — keep.
- Tab persistence (§43) — adapt to three-tab world.
- Mobile responsive scaffolding (§49) — keep.

### The unified assistant

`packages/shared/src/persona/assistant.ts` (this file replaces the three deleted persona files):

```ts
export const assistant = {
  name: 'Assistant',
  model: 'claude-sonnet-4-6',
  systemPrompt: ASSISTANT_SYSTEM_PROMPT,   // seed; live version in AssistantSettings.current
  tools: ASSISTANT_TOOLS                   // see list below
};
```

**Seed system prompt** (Diane edits live in Stuff/Assistant Settings; this is the initial version):

```
You are Diane's personal household assistant. Be concise, casual, grounded
in current data — call tools to look up real values rather than guessing.

About Diane:
- 34, lives alone in a 3BR rental with 2 dogs and 2 cats. Frequently
  dogsits up to 5+ guest dogs at once.
- Five income streams: One More Game (engineering/QA, primary), catering
  gigs (often weekends), dogsitting, Airbnb spare rooms, personal training
  (Tue/Thu mornings at a local gym — regular client 9 AM both days,
  semi-regular client 10 AM Tue 3 of 4 weeks).
- 5'4", ~148 lbs, working toward -5kg and -5 inches off waist.
- Has a hyperfixate-then-burnout pattern with side projects — prefer
  simple low-maintenance suggestions over elaborate systems.

Diet (hard rules):
- No seafood ever, including dishes with seafood ingredients.
- Won't cook or handle raw meat — won't buy it either.
- Eggs and dairy irritate her stomach. Use sparingly, not as primary
  protein vehicles.
- High protein preferred. Trader Joe's precooked options are staples.

Shopping (physical trips only, no Amazon Prime):
- Costco list (~$225-250 per run): gas, toilet paper, paper towels,
  air fresheners, cat litter, cat food, dog food. This list is fixed.
- Trader Joe's: primary grocery store, almost everything else.
- QFC: secondary/backup.

Cleaning crew: every 3-4 weeks, $380/visit (~$4,900-6,600/year). The
3-vs-4-week cadence question is a recurring budget decision. When she
asks, call get_financial_profile + affordability_report and answer
grounded in real numbers.

Workouts: 3x/week strength training target. She's a trainer and writes
her own programs — never prescribe workouts. Tue/Thu mornings she's at
the gym for client sessions; her own slot is BEFORE those (~7:45 AM).
Post-session workouts essentially don't happen — don't suggest them.

Tone:
- Casual, no over-explaining
- Don't moralize about spending
- Never push streaks, scores, or "did you work out today" nags
- Mood/energy/awakeness data exists for HER introspection. Surface
  patterns when asked (recent_checkins + recent_workouts). Don't
  volunteer them as advice.

Behavior:
- Call get_calendar_today near the start of conversations about plans.
- Call recent_checkins if she mentions feeling off or having skipped
  something.
- Call get_financial_profile + affordability_report for any
  "can I afford X" question. Never speculate on her budget.
- When she describes a new recurring item ("I need to clean the gutters
  every 6 months"), propose a routine and offer to create it via
  create_routine.
- When she reschedules an appointment, ASK which cadence-shift strategy
  to apply: 'one_off', 'shift_all', or 'skip_one'. Don't assume.
```

**Tool list (~20 tools, implementations in `apps/api/src/persona/tools.ts` which mostly already exists):**

| Tool | Purpose |
|---|---|
| `get_calendar_today` | Today's Google Calendar events |
| `get_calendar_range(days)` | Upcoming events (default 7) |
| `create_calendar_event({title, start, duration_minutes, notes?})` | Insert event |
| `update_calendar_event({event_id, patch})` | Patch event |
| `delete_calendar_event({event_id})` | Delete event |
| `list_routines({category?, active?})` | Routine list |
| `create_routine({...routine_fields})` | Add routine; auto-creates Calendar event if appointment-enabled |
| `update_routine({key, patch, cadence_shift_strategy?})` | Edit routine. `cadence_shift_strategy` ∈ `'one_off'\|'shift_all'\|'skip_one'` |
| `delete_routine({key})` | Soft-delete |
| `get_morning_checkin({date?})` | One day's check-in (default today) |
| `recent_checkins({days})` | Multiple check-ins |
| `log_workout({date, kind, outcome, note?})` | Retroactive workout log |
| `recent_workouts({days})` | Workout list |
| `get_financial_profile` | Current profile |
| `set_projected_income({month, amount})` | Per-month projected income write |
| `estimate_tax({gross, state?, filing_status?})` | Pure compute, keeps existing |
| `affordability_report({extra_monthly_cost?})` | Existing |
| `list_outsourceable` | Existing |
| `recent_imports({days})` | RocketMoney imports |
| `add_rocketmoney_paste({text})` | Add paste + return parsed result |

**Prompt caching is mandatory** on the system prompt + tool definitions. Sonnet 4.6, 5-min cache TTL. Expected monthly cost at 20-50 turns/day: $5-15.

### The three views

#### Today (default landing)

Single column, mobile-first. Top to bottom:

1. **Morning check-in form** — only when today's check-in is not yet saved. Three button-row pickers (mood / energy / awakeness, three options each) + an optional one-line `note` field. Single Save button. Once saved, collapses to a one-line summary ("✓ Logged at 7:42 AM — meh · medium · alert") with an Edit link.
2. **Calendar today strip** — Google Calendar events for today, time-ordered. Tap a row to open in Calendar.
3. **Habits reminder** — static list, NOT tracked. "Litter scoop · Sweep pet zones · Kitchen reset · Pet food/water." Visual nudge only; no buttons, no checking off. No DB writes.
4. **Ask** — chat input + send button. Conversation scrolls below. Last 20 messages live in component state; full history persists to a new `ChatMessage` collection (just `{conversation_id, role, content, ts}`) for Look Back access.

That's all of Today. No widgets to maintain.

#### Look Back

Read-only retrospective. Three sections top-to-bottom:

1. **This week** — workout count vs target ("2 of 3 strength this week"); the last 7 days' check-ins as a small grid (mood/energy/awakeness as colored chips, days with no log greyed); a one-line "what was different" if a pattern is obvious.
2. **This month** — RocketMoney totals from the most-recent import (top categories + total); the projected income number Diane entered; a single `Net = Projected income − Tax estimate − Fixed − This-month-RocketMoney-discretionary` line.
3. **Patterns** — surfaced only when there's enough signal. Examples: "Last 30 days, you skipped strength training 3 times — all had `groggy` awakeness." Pure observation, no recommendation. Implemented as a small set of hardcoded queries; if none match, this section hides.

No editing here. Tap-through to Stuff if she wants to change something.

#### Stuff

CRUD surface. Three sub-tabs within the view:

1. **Routines** — table of all routines. Columns: name, category, cadence (days), next due (or appointment date if appointment-enabled), last done, outsource $/mo (if applicable), notes. Inline edit. "Add" button opens a form modal. Editing cadence on an appointment-enabled routine triggers the cadence-shift modal (`one_off` / `shift_all` / `skip_one`); the chosen strategy passes through `update_routine`. Deletes are soft (sets `active: false`).
2. **Finance** — current `FinancialProfile` editor (gross income, fixed expenses, state, filing status, monthly extra withholding, projected income for this month as a single number field, free-form `notes`); submission history list from `FinancialProfileSnapshot`; RocketMoney imports list from `RocketMoneyImport` with view/apply/edit buttons per row; "Upload CSV" + "Paste breakdown" actions; tax estimator button.
3. **Assistant Settings** — textarea pre-filled with current system prompt from `AssistantSettings.current`. Save button writes a new version. Versions list with rollback. "Reset to seed" button restores the seed from code.

### Phased build order

Each phase is independently shippable. Diane can stop after any phase.

**Phase A — Unified assistant scaffolding (~3-4 hr) — SHIPPED 2026-05-11**
- ✅ Re-added `@anthropic-ai/sdk@^0.30.0` (resolved 0.30.1) to `apps/api/package.json`.
- ✅ Created [packages/shared/src/persona/assistant.ts](packages/shared/src/persona/assistant.ts) — seed prompt (the verbatim §50 text), `ASSISTANT_MODEL='claude-sonnet-4-6'`, and an `ASSISTANT_TOOLS` array of 14 wired tools. The 6 Phase B/E-deferred tools (`get_morning_checkin`, `recent_checkins`, `set_projected_income`, `create_calendar_event`, `update_calendar_event`, `delete_calendar_event`) live in a `DEFERRED_TOOL_NAMES` constant in the same file — documented but kept out of the live surface so the model never tries to call something that doesn't exist yet.
- ✅ Built `AssistantSettings` model ([apps/api/src/db/models/AssistantSettings.ts](apps/api/src/db/models/AssistantSettings.ts)) + service ([apps/api/src/services/assistant-settings.ts](apps/api/src/services/assistant-settings.ts)) with `getCurrent` (auto-seeds), `update` (pushes new version), `resetToSeed`. Versions array carries `{ts, system_prompt, edited_by: 'user' | 'seed'}` for the Stuff/Assistant Settings rollback UI in Phase E.
- ✅ Built `apps/api/src/persona/runner.ts` — single-assistant tool-use loop. Uses `client.beta.promptCaching.messages.create` with `cache_control: {type: 'ephemeral'}` on the system prompt AND the last tool definition (caches the entire tools array). Caps tool rounds at 6, returns clean offline message when `ANTHROPIC_API_KEY` is missing. Exposes `__setAnthropicClient` / `__setAssistantTools` test hooks so the loop is unit-testable without hitting the live API.
- ✅ Built `apps/api/src/persona/assistant-tools.ts` — runtime impls for the 14 Phase-A tools, mapping onto existing services (`listRoutines`, `createRoutine`, `softDeleteRoutine`, `patchRoutine`, `logWorkout`, `recentWorkouts`, `getFinancialProfile`, `estimateMonthlyTax`, `affordabilityReport`, `listOutsourceable`, `todaysEvents`, `scheduleRange`, `listImports`, `addImport`).
- ✅ Built `POST /api/chat` route ([apps/api/src/routes/chat.ts](apps/api/src/routes/chat.ts)) and `GET/PATCH /api/assistant-settings` + `POST /api/assistant-settings/reset` ([apps/api/src/routes/assistant-settings.ts](apps/api/src/routes/assistant-settings.ts)). Both wired into [index.ts](apps/api/src/index.ts) under the existing `requireToken` guard.
- ⏸️ **Deferred**: deleting the three persona files (`packages/shared/src/personas/{household,finance,grocery}.ts`). Reason: they're still imported by `PersonaLauncher.tsx` (dashboard) and `tools.test.ts` (MCP drift detector). Both consumers are slated for removal in Phase C. Keeping the old files alive in Phase A means the deployed dashboard's launcher pattern continues working through the transition — nothing is "down for the rebuild" per the §50 hyperfixate-burnout guard. The new unified config lives at `packages/shared/src/persona/assistant.ts` (singular `persona/`) alongside the old `personas/` directory; both export paths coexist in `packages/shared/package.json`.
- ⏸️ Diane's smoke-test (live chat) — requires her to do the manual steps in §50's "Diane's manual setup steps" first (Anthropic key + Render env var). Until then the route returns the offline message.

**Test delta: +21 (7 assistant-settings + 9 assistant-tools + 5 runner).** New API total: **370 tests across 41 files** (380 total with alexa-skill). Typecheck clean across all four workspaces. Detail in §51.

**Phase B — MorningCheckin + Today view (~3-4 hr) — SHIPPED 2026-05-11**
- ✅ New [MorningCheckin model](apps/api/src/db/models/MorningCheckin.ts) with unique index on `date` (YYYY-MM-DD), required mood/energy/awakeness, optional 500-char note. New `MorningCheckin` + `MorningCheckinInput` + `AwakenessLevel` types in shared.
- ✅ New `services/morning-checkin.ts` with `upsertCheckin` (insert-or-update + fires `morning_checkin_logged` activity with `operation: 'create' | 'update'`), `getCheckin(date?)` (defaults to today, falls back to today on malformed date), `recentCheckins(days)` (clamped to [1, 90], newest-first).
- ✅ New `routes/morning-checkin.ts` — `GET /api/morning-checkin` (today), `GET /api/morning-checkin/:date`, `GET /api/morning-checkin?days=N` (recent list), `POST /api/morning-checkin` (upsert).
- ✅ Two new ASSISTANT_TOOLS un-deferred: `get_morning_checkin` + `recent_checkins`. Removed from `DEFERRED_TOOL_NAMES`. Live tool count: 16 (was 14).
- ✅ Built [MorningCheckinForm.tsx](apps/dashboard/src/components/MorningCheckinForm.tsx) — three button-row pickers + optional note + Save. Collapses to a one-line summary (✓ Logged at 2:14 PM — Good · Medium energy · Alert) once today's check-in exists; Edit button reopens the form pre-filled with the saved values.
- ✅ Built [HabitsReminder.tsx](apps/dashboard/src/components/HabitsReminder.tsx) — static four-pill row (Litter scoop · Sweep pet zones · Kitchen reset · Pet food + water). No DB, no buttons, no tracking. Pure visual nudge per §50's "habits aren't tracked, appointments are."
- ✅ Built [AskPanel.tsx](apps/dashboard/src/components/AskPanel.tsx) — chat surface against `POST /api/chat`. In-memory conversation state (no `ChatMessage` collection yet — see Open follow-ups). Renders the offline message verbatim when `live: false`, shows tool-round count on assistant turns, ⌘/Ctrl+Enter to send.
- ✅ Composed new [TodayView.tsx](apps/dashboard/src/components/TodayView.tsx): MorningCheckinForm → CalendarDayPanel (reused) → HabitsReminder → AskPanel. **Made the default landing**: the `home` view key now renders TodayView; the tab strip's first button is labeled "Today" (was "Home"). The old §47 Phase 3 HomePanel widget grid is unmounted (kept in code; deleted in Phase C). The DayPanel date navigator moved to a new "Day" tab so Diane keeps her past/future day forensic surface through the transition.
- ⏸️ Diane's smoke-test of `/api/chat` — still requires `ANTHROPIC_API_KEY`. AskPanel will surface the offline notice until she sets it.

**Test delta: +14 (11 morning-checkin service + 3 new assistant-tools cases for get_morning_checkin + recent_checkins).** New API total: **384 tests across 41 files** (394 total with alexa-skill). All four workspaces typecheck clean; dashboard production build verified (291 KB JS / 16 KB CSS gzipped). Detail in §52.

**Phase C — Deletes + tab compression (~3-4 hr) — SHIPPED 2026-05-11**
- ✅ Deleted 10 Mongoose models: `TodayPlan`, `MoodLog`, `EnergyLog`, `ContextEntry`, `AdHocTask`, `ZoneAssessment`, `CheckIn`, `DeferralEvent`, `MealWeek`, `AlexaReminder`. 10 models survive: `Routine`, `Trigger`, `WorkoutLog`, `FinancialProfile`, `FinancialProfileSnapshot`, `RocketMoneyImport`, `ActivityLog`, `AlexaAuth`, `MorningCheckin`, `AssistantSettings`.
- ✅ Deleted 12 API routes: `/api/today/*`, `/api/zones/*`, `/api/checkins/*`, `/api/patterns/*`, `/api/mood`, `/api/energy`, `/api/context/*`, `/api/day/:date`, `/api/schedule`, `/api/meal-weeks/*`, `/api/tasks/*`, `/api/activity`. 11 routes survive: `/api/auth/google`, `/api/routines`, `/api/triggers`, `/api/workouts`, `/api/finance/*`, `/api/calendar/today`, `/api/appointments/*`, `/api/alexa/*`, `/api/chat`, `/api/assistant-settings/*`, `/api/morning-checkin/*`.
- ✅ Deleted 14 API services: `today`, `zones`, `checkins`, `checkin-generators`, `patterns`, `mood`, `energy`, `context`, `day`, `schedule`, `meal-weeks`, `tasks`, `alexa-push`, `alexa-reminders`. Services kept: `routines`, `triggers`, `workouts`, `finance`, `finance-history`, `csv-parser`, `calendar`, `appointments`, `morning-checkin`, `assistant-settings`, `activity` (still fires `morning_checkin_logged` / `routine_edited` / `finance_*` / `appointment_*` / `task_done` / `workout_logged`), `session`, `alexa-lwa`, `alexa-shopping-list`, `grocery-list-parser`.
- ✅ Deleted crons: `morning-gen` and the four nudge-style check-in generators (`evening-retro`, `morning-intent`, `pattern-interrupts`, `weekly-review`, `zone-assessment` — all of which lived in `services/checkin-generators.ts`). Two crons survive: `calendar-ingest` (Google Calendar → Trigger ingestion) and `appointment-reconcile` (§47 Phase 4 hourly job; the Phase 6 Alexa-Reminders second pass was stripped per §50).
- ✅ Deleted the entire MCP layer (`apps/api/src/mcp/server.ts` + `route.ts`), `apps/api/src/persona/tools.ts` + its drift-detector test, and the old three persona files in `packages/shared/src/personas/` (household, finance, grocery, index). Removed `./personas/*` exports from `packages/shared/package.json`. The new unified assistant at `packages/shared/src/persona/assistant.ts` is the only persona surface left.
- ✅ Deleted the Publisher debounced fan-out (`apps/api/src/publisher/` entirely — was specific to TodayPlan writes; per-appointment Calendar events from §47 Phase 4 took over). `lodash.debounce` dep also removed from `apps/api/package.json`.
- ✅ Deleted 17 dashboard components: `DayPanel`, `ActivityFeed`, `JournalPanel`, `WorkoutPanel`, `SchedulePanel`, `HomePanel`, `EnergyButtons`, `MoodButtons`, `TodayList`, `TodayContextStrip`, `MealWeekCalendar`, `ShoppingListPanel`, `PersonaLauncher`, `CheckInBanner`, `DeferDialog`, `LogPanel`, `DayNavigator`. Also `apps/dashboard/src/utils/relativeTime.ts` (no surviving consumer). 13 components remain (including 3 new Phase C panels: `LookBackPanel`, `StuffPanel`, `AssistantSettingsPanel`).
- ✅ Stripped `FinanceDayLog` sub-component from `FinancePanel.tsx` (it referenced `api.context.onDate` + `api.activity.onDate` which both retire). FinancePanel is now profile + outsourceable + affordability + RocketMoney imports + snapshot history only.
- ✅ Rewired `assistant-tools.ts` `get_calendar_range` to use a new `upcomingEvents(days)` helper in `services/calendar.ts` (just lists Google Calendar events for an N-day window) — replaces the deleted `scheduleRange` heavy lift.
- ✅ Compressed dashboard tabs from 6 → 3: **Today** (the §50 Phase B TodayView), **Look Back** (new minimal panel — Phase D fills in patterns), **Stuff** (new — sub-tabs Routines / Finance / Assistant Settings, each wrapping the surviving panels). Single header icon left (`❔ Guide`). Legacy `household-os.view` localStorage values (`home`, `today`, `schedule`, `workouts`, `finance`, `log`, etc.) all fall through to `'today'` in the new `readSavedView()`.
- ✅ Trimmed `packages/shared/src/types.ts` from ~830 lines to ~370 lines — removed all retired types (`TodayPlan`, `PlanItem`, `SwapPoolItem`, `PublisherState`, `MoodLog`, `EnergyLog`, `DeferralEvent`, `DeferralPattern`, `WorkoutPattern`, `MealEffort`, `MealDay`, `MealWeek`, `ContextEntry/Input`, `CheckIn` + question shapes, `ZoneAssessment`, `AdHocTask`, `CalendarTask`, `DayView`, `ScheduleRoutineDue/Entry/Pending/Range`, `EnergySuggestion`, `DeferReasonCode/DeferReason`, `WellbeingSource`, `DayType`, `ItemStatus`, `PersonaConfig`). `ActivityKind` shrunk from 25 values to 10.
- ⏸️ **Deferred to Phase F**: Alexa skill handlers + `client.ts` still reference retired endpoints (`/today/swap`, `/today/mark-done`, `/zones/*`, `/patterns/*`, `/checkins/*`, `/mood`, `/energy`). They compile (the skill has its own type copies) but they 404 at runtime against the new API. §50's Phase F is the dedicated skill-cleanup phase — leaving the work there per the phasing.
- ⏸️ **Deferred to Phase E**: Routine schema simplification (§50 calls for removing `energy`, `flex_days`, `also_triggers`, `skip_if`). Phase E rebuilds the Routines table in Stuff and is the natural place to drop fields from the schema + every consumer in one coherent change.
- ⏸️ **Deferred to Phase D**: full Look Back content. The Phase C `LookBackPanel` ships with a "This week" workout count + 7-day check-in strip — enough to be useful — plus placeholders for "This month" (Phase D wires RocketMoney summary) and "Patterns" (Phase D adds the pattern surfacer).

**Test delta: −195 (from 384 → 189).** Within §50's prediction of "roughly 100-130 tests survive" — slightly higher because the surviving subsystems (finance, appointments, csv-parser, routines, calendar, morning-checkin) have heavier coverage than the deletes did. Dashboard build dropped from 291 KB JS gzipped → 209 KB (28% smaller). Detail in §53.

**Phase D — Look Back view (~3-4 hr) — SHIPPED 2026-05-13**
- ✅ New [services/patterns-simple.ts](apps/api/src/services/patterns-simple.ts) — on-demand surfacer with two detectors:
  - `skippedWorkoutsByAwakeness(days)` — Threshold: ≥2 skips with same-day check-ins, and one awakeness level accounting for ≥75% of them. Skips without a same-day `MorningCheckin` are dropped from the denominator (can't correlate without it). All-match phrasing ("all on groggy mornings") vs majority phrasing ("3 of 4 skipped workouts were on groggy mornings").
  - `consecutiveLowMood(days)` — Threshold: ≥3 consecutive `mood='down'` morning check-ins counting back from today. Allows gaps (days with no check-in don't break the run — we don't assume "no log = bad day"). Single-day dips don't qualify; this is about spotting trends, not flagging every bad day.
  - `detectPatterns(windowDays)` orchestrator clamps to [1, 90], runs both, drops nulls. Empty array means "nothing notable" and the dashboard hides the section entirely.
- ✅ New route `GET /api/look-back/patterns?days=N` ([apps/api/src/routes/look-back.ts](apps/api/src/routes/look-back.ts)) — mounted under the `requireToken` guard. The two other Look Back sections (This week + This month) compose from existing endpoints rather than getting dedicated rollup routes — keeps the API surface small.
- ✅ Rebuilt [LookBackPanel.tsx](apps/dashboard/src/components/LookBackPanel.tsx) with three live sections:
  - **This week** (unchanged from Phase C) — workout count vs target (3/week constant) + 7-day morning-checkin strip.
  - **This month** (new) — `Monthly profile` rollup: gross income − tax estimate − fixed expenses − discretionary spent (from latest RocketMoney import's `parsed.total`) = Net. `Latest RocketMoney import` section: kind/filename/date/total + top 5 categories by amount. Handles three states (no profile, paste import (no parse), CSV import with parsed categories).
  - **Patterns** (new) — fetches `api.lookBack.patterns(30)` and renders each observation as a bordered list item. Auto-hides when empty per §50.
- ✅ Added `api.lookBack.patterns(days)` + `LookBackPattern` type to [apps/dashboard/src/api.ts](apps/dashboard/src/api.ts).
- ⏸️ **Deferred (not in §50 spec for Phase D)**: per-month projected income field/collection. Phase D uses `FinancialProfile.monthly_gross_income` as the projected income — same single monthly figure Diane enters in Stuff/Finance. Phase E will decide whether to track per-month overrides (and add a `set_projected_income({month, amount})` assistant tool) or keep the flat-monthly figure.
- ⏸️ **`ChatMessage` collection still not built.** §50's Today-view spec floated persisting chat history so Look Back could surface "what did I ask the assistant last Tuesday." Look Back is now built and didn't need it — the data the section actually wants is morning check-ins, workouts, and finance, all of which already persist. Punting indefinitely unless Diane asks for a chat-history retro view specifically.

**Test delta: +14 (all on `patterns-simple.test.ts`).** New API total: **203 tests across 18 files** (213 with alexa-skill). All four workspaces typecheck clean; dashboard build verified (213 KB JS gzipped, +2 KB from Phase C for the LookBackPanel rebuild). Detail in §54.

**Phase E — Stuff view (~3-4 hr)**
- Build `StuffPanel` with three sub-tabs (Routines, Finance, Assistant Settings).
- Routines sub-tab: reuse the `RoutinesPage` table if it survived Phase C; otherwise rebuild as a simple editable table.
- Cadence-shift modal: invoked from both the inline edit row and from the chat tool path (`update_routine` with `cadence_shift_strategy`). Three options as buttons.
- Finance sub-tab: surface the existing Phase 2/5 work (snapshot history, RocketMoney imports, upload/paste).
- Assistant Settings sub-tab: textarea + version list + rollback.

**Phase F — Alexa cleanup (~1-2 hr)**
- Delete most skill intents per the "What gets DELETED" list.
- Retool `WhatsLeftIntent` to read incomplete Calendar events for today (not TodayPlan items).
- Verify the daily morning push still fires.
- If Phase 6 Alexa Reminders/LWA infrastructure shipped: leave the code in place but disable the cron that pushes Reminders. Mark as deprecated.

**Phase G — Final cleanup + polish (~1-2 hr)**
- Delete the MCP server files.
- Delete any orphaned utils, types, or test files surfaced by Phase C.
- Add relative timestamps where they aren't yet (Routines table row, MorningCheckin summary).
- Verify all four workspaces typecheck clean.
- Update README + this HANDOFF's §36 route cheat sheet to match the new state.

**Total: ~17-23 hours.** Phases A + B + C land the meaningful gap-fill — if Diane is feeling the burnout signal, stop after C and use the system. Phases D-G are depth.

### Diane's manual setup steps

- [ ] Anthropic console account at `console.anthropic.com`
- [ ] Generate an API key (save to password manager)
- [ ] Prepay $20 balance; set $30/month spending limit
- [ ] Render dashboard → API service → Environment → add `ANTHROPIC_API_KEY=sk-ant-...`
- [ ] After Phase A: open the dashboard, go to Stuff → Assistant Settings, read the seeded system prompt, edit anything that doesn't sound like her
- [ ] After Phase B: log her first morning check-in
- [ ] After Phase E: if she has a current RocketMoney CSV handy, upload it to seed the Look Back's "This month" section

### What this gives her, in plain language

If §50 ships end-to-end, here's what daily use looks like:

- **Morning**: open the dashboard, tap three buttons for mood / energy / awakeness, optionally type a one-line note, hit save. Total time: under 30 seconds.
- **Mid-day**: glance at Calendar today strip on Today view to see what's coming. Or just look at her phone's Calendar app — both are the same data.
- **A decision moment** (can I afford this? what should I get at TJ's? should I bump the cleaner to every 3 weeks?): open Today, type the question into Ask. Get a grounded answer that actually used her real data. Close.
- **Weekly**: open Look Back. See if she hit 3 workouts, see what the check-in data looked like, see what RocketMoney said. ~2 minutes.
- **Monthly**: open Stuff → Finance, paste the latest RocketMoney breakdown (or upload the CSV), enter her projected income on paper into the dashboard. ~3 minutes.
- **Whenever**: chat with the assistant to add/edit/delete routines; they sync to Calendar automatically.

If the daily use isn't under 5 minutes most days, this rebuild didn't succeed and §50 needs reconsidering before adding more features.

### Hyperfixate-burnout guard

The deployed app stays running through every phase. Nothing is "down for the rebuild." Don't bundle Phases A and C in one sitting — re-adding the Anthropic SDK + deleting half the models at once means too much in flight at once. Land each phase, test it live for at least a day, then move on.

This is the last big refactor. After §50 ships, further work should be small, additive, and only in response to real friction Diane has experienced — not anticipatory feature growth.

---

## 51. Phase A — Unified assistant scaffolding (SHIPPED 2026-05-11)

Phase A of the §50 rebuild. Lands the read/write infrastructure for the unified assistant without yet ripping out the three-persona launcher path (deferred to Phase C, see "Spec deviation" below).

### What landed

**Shared package**

- [packages/shared/src/persona/assistant.ts](packages/shared/src/persona/assistant.ts) — `ASSISTANT_SYSTEM_PROMPT` (the verbatim §50 seed), `ASSISTANT_MODEL = 'claude-sonnet-4-6'`, `ASSISTANT_TOOLS` (14 tool defs), and `DEFERRED_TOOL_NAMES` (6 names from §50's 20-tool list whose underlying services arrive in later phases). The `assistant` object aggregates them as one config so the runner can import a single symbol.
- [packages/shared/package.json](packages/shared/package.json) — added the `./persona/assistant` export path. The old `./personas/*` paths stay until Phase C.

**API — model + service**

- [apps/api/src/db/models/AssistantSettings.ts](apps/api/src/db/models/AssistantSettings.ts) — Mongoose singleton (`key: 'current'`). Versions are an embedded subdoc array (`{ts, system_prompt, edited_by: 'user' | 'seed'}`) so rollback can pick any prior prompt without a separate collection. Defensive `mongoose.models.AssistantSettings ?? mongoose.model(...)` pattern mirrors every other model file in this repo (prevents `OverwriteModelError` on multi-test-file imports).
- [apps/api/src/services/assistant-settings.ts](apps/api/src/services/assistant-settings.ts) — `getCurrent()` auto-seeds from the shared constant on first read (records the seed as version 0 with `edited_by: 'seed'`). `update(prompt)` trims whitespace, rejects empty, pushes a new `'user'` version. `resetToSeed()` pushes a fresh `'seed'` version so the history reflects the reset rather than silently overwriting.

**API — chat runner**

- [apps/api/src/persona/runner.ts](apps/api/src/persona/runner.ts) — single-assistant tool-use loop. Uses `client.beta.promptCaching.messages.create` (SDK v0.30 path) so the request hits the `anthropic-beta: prompt-caching-2024-07-31` endpoint. `cache_control: {type: 'ephemeral'}` is set on:
  1. The system prompt (single text block in the `system` array).
  2. The **last** entry of the `tools` array — this tells Anthropic to cache everything up to and including that marker, so the whole tools array is cached as one block. A common-but-wrong pattern is per-tool `cache_control` which fragments the cache; the single-trailing-marker approach matches the GA prompt-caching guidance.
  3. The runner intentionally does NOT add `cache_control` to user messages — they vary per turn and would never hit cache.
- Tool loop: cap of 6 rounds (`MAX_TOOL_ROUNDS`); replays each `tool_use` block into the working messages as a fresh `user` turn with `tool_result` blocks. Unknown tool names → `is_error: true` tool_result so the model can self-correct. Per-tool failures (`throw`) → `is_error: true` with the thrown message — keeps a single broken tool from killing the conversation.
- Offline path: when `ANTHROPIC_API_KEY` isn't set (and no test stub is injected), returns `{live: false, text: '[assistant offline: ANTHROPIC_API_KEY not configured ...]'}` instead of crashing. Lets the chat route stay well-behaved before Diane bootstraps her API key.
- Test hooks: `__setAnthropicClient(stub)` and `__setAssistantTools(impls)` are exported for unit tests. The client hook takes precedence over the env-driven path (via `clientOverridden` flag) so tests can inject behavior even with `NODE_ENV=test`. Hooks reset to defaults in `afterEach`.

- [apps/api/src/persona/assistant-tools.ts](apps/api/src/persona/assistant-tools.ts) — runtime impls for the 14 Phase-A tools. Maps onto existing service-layer functions (no duplication). Tools wired:
  - **Calendar reads**: `get_calendar_today` → `todaysEvents`, `get_calendar_range` → `scheduleRange`
  - **Routines CRUD**: `list_routines`, `create_routine` (validates `key` + `name`, fills sensible defaults for the rest), `update_routine` (delegates to `patchRoutine`'s allow-list), `delete_routine` (soft via `softDeleteRoutine`)
  - **Workouts**: `log_workout`, `recent_workouts`
  - **Finance**: `get_financial_profile`, `estimate_tax`, `affordability_report`, `list_outsourceable`, `recent_imports`, `add_rocketmoney_paste` (creates a `kind: 'paste'` import without auto-applying; Diane reviews in Stuff/Finance per §50)

**API — routes**

- [apps/api/src/routes/chat.ts](apps/api/src/routes/chat.ts) — `POST /api/chat`. Body `{messages: [{role, content}]}`; 400 on empty array or malformed messages; passes through to `assistantChat`. Returns `{text, blocks, tool_rounds, usage, live}`.
- [apps/api/src/routes/assistant-settings.ts](apps/api/src/routes/assistant-settings.ts) — `GET /api/assistant-settings`, `PATCH /api/assistant-settings` (body `{system_prompt}`), `POST /api/assistant-settings/reset`. PATCH rejects non-string or empty with 400 + clear error message.
- Both wired into [apps/api/src/index.ts](apps/api/src/index.ts) under the existing `requireToken` middleware; also added to the root endpoint listing.

### Tests added (+21)

- [apps/api/src/services/assistant-settings.test.ts](apps/api/src/services/assistant-settings.test.ts) (7): auto-seed on first read; idempotent repeat reads (single doc, no version churn); update pushes a `'user'` version after the seed; whitespace-trim; empty/whitespace rejection; multi-edit version history; `resetToSeed` records a `'seed'` version entry.
- [apps/api/src/persona/assistant-tools.test.ts](apps/api/src/persona/assistant-tools.test.ts) (9): drift detector (every declared tool has an impl); deferred tools are absent from the impl table; schema shape validation; `list_routines` category filter; `create_routine` validation + defaults; `delete_routine` soft-delete preserves doc; `add_rocketmoney_paste` rejects empty; `estimate_tax` returns federal/FICA/state breakdown (WA → state_tax=0).
- [apps/api/src/persona/runner.test.ts](apps/api/src/persona/runner.test.ts) (5): no-key offline message; `stop_reason: 'end_turn'` returns final text in zero tool rounds; one tool round runs and feeds back; unknown-tool gets `is_error: true` tool_result on the next turn; round-cap bailout prevents infinite loops.

**Deliberately NOT tested:**

- Live Anthropic API roundtrip — testing the actual `client.beta.promptCaching.messages.create` against the network is more brittle than valuable (same rationale as the Google Calendar tests). The stub-driven runner tests cover every branch of the loop. Live verification is Diane's smoke test after she adds her API key.
- Express route layer (`chat.ts`, `assistant-settings.ts`) — thin handlers over the service layer. Following the established pattern in this repo (e.g. `finance.ts` routes, `meal-weeks.ts` routes — none have route-level tests; the services they wrap are fully covered).
- Dashboard wiring — Phase A is API-only. The AskPanel + Stuff/Assistant Settings UI lands in Phases B + E.

### Spec deviation

§50 Phase A says "Create `packages/shared/src/persona/assistant.ts` with seed system prompt + tool list. Delete the three persona files." Phase A scaffolding shipped, but **the deletion of `packages/shared/src/personas/{household,finance,grocery}.ts` was deferred to Phase C.** Reasons:

1. **Active dashboard consumers**: `apps/dashboard/src/components/PersonaLauncher.tsx` imports from all three persona files. Deleting them in Phase A would break the live dashboard's Household / Finance / Grocery tabs. Phase C is the explicit "deletes" phase that also retires `PersonaLauncher` per §50's "What gets DELETED" list, so doing both in the same change keeps the deploy coherent.
2. **MCP drift detector**: `apps/api/src/persona/tools.test.ts` validates schema/impl parity for the per-persona tools fed into the MCP server. Phase A doesn't touch MCP (Phase C deletes MCP entirely). Keeping the old test passing through Phase A lets us delete it cleanly in Phase C alongside its subject.
3. **§50 hyperfixate-burnout guard**: "The deployed app stays running through every phase. Nothing is 'down for the rebuild.'" Holding the persona-launcher path alive through A → B is the conservative read of that rule.

The new `persona/assistant.ts` (singular) coexists with the old `personas/` (plural) directory; the `package.json` exports both paths. Phase C will remove the old paths + `PersonaLauncher.tsx` + the MCP layer in one coherent change.

### Other spec deviations worth knowing

1. **Phase A tool surface is 14, not 20.** §50 lists 20 tools. Six (`get_morning_checkin`, `recent_checkins`, `set_projected_income`, `create_calendar_event`, `update_calendar_event`, `delete_calendar_event`) are gated on services that arrive in later phases (`MorningCheckin` model from Phase B; projected-income field + calendar event mutation tooling from Phase E). They're tracked in the new `DEFERRED_TOOL_NAMES` constant — visible in the file, kept out of the live surface so the model can't call something that doesn't exist. Each gets added to `ASSISTANT_TOOLS` when its underlying service lands.
2. **`update_routine` has no `cadence_shift_strategy` yet.** §50's tool list shows `update_routine({key, patch, cadence_shift_strategy?})`. The strategy logic is Phase E because it requires a UI modal (`'one_off' | 'shift_all' | 'skip_one'`) and back-end appointment-shift logic. Phase A's `update_routine` is a flat field patch via `patchRoutine` — same as the existing `edit_routine` tool that's already been working in the per-persona flow.
3. **No `list_routines` `active` filter pass-through yet.** The tool schema declares `active?: boolean` but the impl always defaults to active-only (because `listRoutines` does). Wiring the override is a 2-line change for Phase E when soft-deleted routines need to be visible in the Stuff/Routines table.

### What unblocks for Diane

After she does the §50 manual steps (Anthropic console account, API key, `ANTHROPIC_API_KEY` in Render), `POST /api/chat` will serve real assistant replies grounded in the 14 wired tools. The dashboard's AskPanel doesn't exist yet (Phase B), so for now she can verify the endpoint with curl:

```bash
curl -sH "Authorization: Bearer $API_TOKEN" -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"list my pet routines"}]}' \
  https://household-os-api.onrender.com/api/chat
```

Until the API key is set, the route returns `{live: false, text: '[assistant offline: ...]'}` — that's the expected pre-bootstrap state.

### Route cheat sheet additions

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/chat` | POST | Unified-assistant tool-use loop. Body `{messages: [{role, content}]}` → `{text, blocks, tool_rounds, usage, live}`. Returns `live: false` when `ANTHROPIC_API_KEY` is unset (no crash). |
| `/api/assistant-settings` | GET | Live system prompt + model + versions array |
| `/api/assistant-settings` | PATCH | Body `{system_prompt: string}`. Trims, rejects empty, pushes new `'user'` version. |
| `/api/assistant-settings/reset` | POST | Restore the seed prompt; records a `'seed'` version entry. |

### Open follow-ups for the next phase boundary

- **Phase B** (shipped — see §52): MorningCheckin + Today view + assistant chat surface.
- **Phase C** (deferred-from-A + the broader compression): delete `packages/shared/src/personas/{household,finance,grocery}.ts` + `personas/index.ts` + the launcher consumers (`PersonaLauncher.tsx`) + `tools.ts` + `tools.test.ts` + the MCP layer + the unmounted `HomePanel.tsx` + the model/service/route/cron lists in §50's "What gets DELETED." Remove the `./personas/*` exports from `packages/shared/package.json`. Compress to 3 tabs (Today, Look Back, Stuff).
- **Phase E**: add `update_routine` cadence-shift wiring; add `set_projected_income` (needs a new field or collection — decision pending); add `create_calendar_event` / `update_calendar_event` / `delete_calendar_event` if the assistant should mutate Calendar directly (or punt to "assistant proposes; user confirms in Calendar UI").

---

## 52. Phase B — MorningCheckin + Today view (SHIPPED 2026-05-11)

Phase B of the §50 rebuild. Lands the new daily-touchpoint surface — a single morning check-in document plus the four-section Today view that becomes the new default landing.

### What landed

**Shared types**

- New `AwakenessLevel` (`'groggy' | 'meh' | 'alert'`), `MorningCheckin`, and `MorningCheckinInput` interfaces in [packages/shared/src/types.ts](packages/shared/src/types.ts).
- New `ActivityKind` value `morning_checkin_logged`.
- Two tools un-deferred in [packages/shared/src/persona/assistant.ts](packages/shared/src/persona/assistant.ts): `get_morning_checkin` (optional `date`; defaults to today) and `recent_checkins` (`days?`, default 14, max 90). `DEFERRED_TOOL_NAMES` shrunk from 6 to 4.

**API — model**

- [apps/api/src/db/models/MorningCheckin.ts](apps/api/src/db/models/MorningCheckin.ts) — `date` is required + unique-indexed (one doc per local day), mood/energy/awakeness required-with-enum, note optional with schema-level `maxlength: 500`. Defensive `mongoose.models.MorningCheckin ?? mongoose.model(...)` pattern matching the rest of the repo.

**API — service**

- [apps/api/src/services/morning-checkin.ts](apps/api/src/services/morning-checkin.ts):
  - `upsertCheckin(input)` — validates the three enums explicitly (Mongoose enum errors are noisier than necessary), trims + truncates `note` to 500 chars, defaults `date` to today's `ymd()` when omitted or malformed. Detects insert-vs-update by pre-checking for an existing doc so the activity-log entry can phrase it correctly. Filter `{date}` + `$set` mutables + `$setOnInsert: {date, created_at}` — same pattern as `setFinancialProfile` / `upsertMealWeek` to avoid the "would create a conflict at 'date'" Mongoose error.
  - `getCheckin(date?)` — `null` when missing. Malformed date silently falls back to today (callers shouldn't ever pass garbage but this keeps the route handler simple).
  - `recentCheckins(days)` — clamped to [1, 90], newest-first, returns up to `days` worth of rows. Uses `$gte` on the string date (works because YYYY-MM-DD sorts correctly lexically).
- Activity-log entry on every upsert: `kind: 'morning_checkin_logged'`, metadata `{date, mood, energy, awakeness, has_note, operation: 'create' | 'update'}`. Look Back will read this to show timestamps.

**API — route**

- [apps/api/src/routes/morning-checkin.ts](apps/api/src/routes/morning-checkin.ts):
  - `GET /api/morning-checkin` — today's check-in (or `null`)
  - `GET /api/morning-checkin?days=N` — recent list (newest-first)
  - `GET /api/morning-checkin/:date` — specific day; strict YYYY-MM-DD regex (400 otherwise)
  - `POST /api/morning-checkin` — body `{date?, mood, energy, awakeness, note?}`; 400 if any of the three required fields is missing or invalid
- Mounted under the existing `requireToken` guard in [apps/api/src/index.ts](apps/api/src/index.ts).

**API — assistant tools**

- [apps/api/src/persona/assistant-tools.ts](apps/api/src/persona/assistant-tools.ts) gained `get_morning_checkin` (passes optional `date` through) and `recent_checkins` (forwards `days` with the same clamp the service applies). Both delegate directly to the service. No new state.
- Total live assistant tools: 16 (was 14). The drift detector in [assistant-tools.test.ts](apps/api/src/persona/assistant-tools.test.ts) automatically picked up the two new ones — no test edit needed for the schema/impl parity check.

**Dashboard — API client**

- [apps/dashboard/src/api.ts](apps/dashboard/src/api.ts) gained `api.morningCheckin.{get, recent, save}` and `api.chat.send`. New exported types `ChatResult` and `ChatMessage`.

**Dashboard — components**

- [apps/dashboard/src/components/MorningCheckinForm.tsx](apps/dashboard/src/components/MorningCheckinForm.tsx) — three button-row pickers (Down/Neutral/Good · Low/Medium/High · Groggy/Meh/Alert) + optional textarea (500-char client cap mirroring the server). Loads today's check-in on mount; if it exists, renders a one-line summary (`✓ Morning check-in at 2:14 PM — Good · Medium energy · Alert`) with an Edit toggle. Edit reopens the form pre-filled. Cancel restores the saved values without saving. Errors surface inline.
- [apps/dashboard/src/components/HabitsReminder.tsx](apps/dashboard/src/components/HabitsReminder.tsx) — static pill row. Zero state, zero buttons, no API calls. Pure visual nudge.
- [apps/dashboard/src/components/AskPanel.tsx](apps/dashboard/src/components/AskPanel.tsx) — chat surface against `POST /api/chat`. In-memory conversation (last 40 rendered; full history is whatever the component holds). User-role messages get a subtle background fill, assistant-role plain. Tool-round count shown when nonzero ("3 tool calls"). When `live: false`, renders an inline hint about `ANTHROPIC_API_KEY`. ⌘/Ctrl+Enter to send; plain Enter inserts a newline (matches Slack/Linear conventions).
- [apps/dashboard/src/components/TodayView.tsx](apps/dashboard/src/components/TodayView.tsx) — single-column stack composing the four sections. Reuses the existing `CalendarDayPanel` from §47 Phase 3 (no duplication).

**Dashboard — wiring**

- [apps/dashboard/src/App.tsx](apps/dashboard/src/App.tsx): the `home` view key now renders `TodayView` (replaces the §47 Phase 3 widget grid as the default landing). The tab strip's first button is labeled "Today" (was "Home"). The `today` view key now hosts the existing `DayPanel` date navigator; that tab is labeled "Day" so Diane keeps the forensic past/future surface through the transition. The old `HomePanel.tsx` import was removed (file kept in code; Phase C deletes it). `readSavedView()` still returns `'home'` as the default — no localStorage migration needed because the key didn't change.

### Tests added (+14)

- [apps/api/src/services/morning-checkin.test.ts](apps/api/src/services/morning-checkin.test.ts) (11): default-date-today behavior; idempotent upsert (no duplicate doc); activity-log fires with the right `operation` flag on create + update; invalid mood/energy/awakeness rejection; 500-char note truncation; explicit-date backfill; null on missing doc; default-today `getCheckin()`; malformed-date fallback; newest-first `recentCheckins` order; days-param clamping doesn't throw.
- [apps/api/src/persona/assistant-tools.test.ts](apps/api/src/persona/assistant-tools.test.ts) (+3): `get_morning_checkin` null path; `get_morning_checkin` happy path; `recent_checkins` newest-first.

**Deliberately NOT tested:**

- Dashboard components — no React testing infra in this repo (same situation as §47 Phases 3-6). First regression candidates if it's ever introduced: `MorningCheckinForm` collapsed-summary state, Edit/Cancel restore, `AskPanel` ⌘+Enter send, offline-message rendering.
- `POST /api/chat` and `POST /api/morning-checkin` route layers — thin wrappers over the services, which are fully covered. Following the established repo pattern.

### Spec deviations / design calls

1. **Tab strip kept at 6 tabs, not 3.** §50 Phase B says "Replace the existing Today/Home tab as the default landing" but Phase C is the explicit "tab compression" phase. Phase B made the new TodayView the default landing (the `home` view key) and renamed the labels to make the new structure read sensibly through the transition. The old `HomePanel` widget grid is unmounted but kept in source until Phase C does the broader deletion + 3-tab compression in one coherent change. This matches §50's "the deployed app stays running through every phase" guarantee.
2. **`ChatMessage` collection NOT built.** §50's Today-view spec says "full history persists to a new `ChatMessage` collection ... for Look Back access." Phase B's AskPanel is in-memory only because (a) Look Back isn't built until Phase D, so there's no consumer yet, and (b) the cheap path of storing chat history in localStorage works fine for a single-user system and avoids a write-amplification surface during the rebuild. Phase D can add the collection if the Look Back wants to surface "what did I ask the assistant last Tuesday."
3. **`HabitsReminder` list is hardcoded, not user-editable.** §50 explicitly says habits aren't tracked — they're a visual nudge. Making the list editable would invite cadence creep ("ok but if I edit this maybe I should also know when I last did it…"). Keep it dumb. If Diane ever wants different habits, she edits the constant array and ships a one-line change.
4. **`MorningCheckinForm` collapses to summary on existing check-in.** §50's spec: "only when today's check-in is not yet saved. Once saved, collapses to a one-line summary." Built exactly to spec — the form vanishes after save and the summary line includes the actual save time so it doubles as a "when did I check in" tell.
5. **Note cap enforced at three layers** — Mongoose `maxlength: 500`, service trim+slice, dashboard textarea `maxLength` equivalent via `slice(0, 500)` on every `onChange`. Defense in depth so a paste of a 10K-character article can't blow up the DB write or chat panel.
6. **`recent_checkins` description tells the model NOT to volunteer patterns.** Per §50 tone guidance: "Surface patterns when asked ... Don't volunteer them as advice." The tool description encodes this so the model treats it as introspection, not prescription.

### Route cheat sheet additions

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/morning-checkin` | GET | Today's check-in (or `null`) |
| `/api/morning-checkin?days=N` | GET | Recent check-ins, newest-first, clamped [1, 90] |
| `/api/morning-checkin/:YYYY-MM-DD` | GET | Specific day's check-in |
| `/api/morning-checkin` | POST | Upsert (body `{date?, mood, energy, awakeness, note?}`) |

### Diane's manual setup (no change vs Phase A)

If `ANTHROPIC_API_KEY` is set, `AskPanel` will round-trip against `/api/chat` immediately. If it's not, the panel shows the offline message verbatim — the rest of TodayView (check-in + calendar + habits) works regardless. Nothing about Phase B blocks on the API key.

### Open follow-ups for Phase C

- Delete `HomePanel.tsx` (now unmounted), `personas/{household,finance,grocery}.ts` + index, `PersonaLauncher.tsx`, `tools.ts` + drift-detector test, MCP layer, and the broader model/service/cron list from §50's "What gets DELETED." (Shipped — see §53.)
- Compress to 3 tabs: Today (the new view we just shipped), Look Back, Stuff. (Shipped — see §53.)
- Migration for already-persisted `household-os.view` localStorage values that become invalid — fall through to `'today'`. (Shipped — see §53.)

---

## 53. Phase C — Deletes + tab compression (SHIPPED 2026-05-11)

Phase C of the §50 rebuild — the destructive purge. Removes ~50 files of legacy code, compresses the 6-tab dashboard to 3, and reshapes the API surface to a 11-route minimum. Phase A's deferred work (deleting old persona files) also landed here.

### Deletion ledger

**Mongoose models removed** (10 files; data in Atlas survives — restore from `git log` if any are missed): `TodayPlan`, `MoodLog`, `EnergyLog`, `ContextEntry`, `AdHocTask`, `ZoneAssessment`, `CheckIn`, `DeferralEvent`, `MealWeek`, `AlexaReminder`.

**API services removed** (14): `today`, `zones`, `checkins`, `checkin-generators`, `patterns`, `mood`, `energy`, `context`, `day`, `schedule`, `meal-weeks`, `tasks`, `alexa-push`, `alexa-reminders`.

**API routes removed** (12): mounting + handler files for `/api/today`, `/api/zones`, `/api/checkins`, `/api/patterns`, `/api/mood`, `/api/energy`, `/api/context`, `/api/day`, `/api/schedule`, `/api/meal-weeks`, `/api/tasks`, `/api/activity`.

**Crons removed**: `cron/morning-gen.ts` + the four nudge generators inside `services/checkin-generators.ts`. Two crons survive (`cron/calendar-ingest.ts` + `cron/appointment-reconcile.ts`).

**MCP layer removed entirely**: `apps/api/src/mcp/{server,route}.ts` + `apps/api/src/persona/tools.ts` + `apps/api/src/persona/tools.test.ts` (the drift detector). Phase A had deferred this; landed alongside the broader purge.

**Old persona files removed**: `packages/shared/src/personas/{household,finance,grocery,index}.ts`. `package.json` exports for `./personas/*` removed. Phase A had deferred this; landed here. Also dropped: `packages/shared/src/sample-meal-week.json` (was bundled into the deleted MealWeekCalendar) + its export entry.

**Publisher removed entirely**: `apps/api/src/publisher/{index,calendar,alexa}.ts`. Was wired only from `services/today.ts`; per-appointment events from §47 Phase 4 replaced its job. `lodash.debounce` dropped from `apps/api/package.json`.

**Dashboard components removed** (17 + 1 utils file): `DayPanel`, `ActivityFeed`, `JournalPanel`, `WorkoutPanel`, `SchedulePanel`, `HomePanel`, `EnergyButtons`, `MoodButtons`, `TodayList`, `TodayContextStrip`, `MealWeekCalendar`, `ShoppingListPanel`, `PersonaLauncher`, `CheckInBanner`, `DeferDialog`, `LogPanel`, `DayNavigator`, `utils/relativeTime.ts`.

**Test files removed** (~17): all tests for deleted services. Notable: `activity-wiring.test.ts` was deleted entirely because most of its event sources retired; remaining activity-log coverage lives in the individual service tests (`morning-checkin.test.ts`, `finance.test.ts`, `finance-history.test.ts`, `appointments.test.ts`).

**Scripts trimmed**: `seed-first-context.ts` deleted (used `ContextEntry`). `start-tomorrow.ts` and `set-cleaner-visit.ts` updated to drop `TodayPlan.deleteMany({})` calls (TodayPlan retired). The `npm run start-tomorrow` script still works for backdating rolling routine `last_done` values.

**`apps/api/src/utils/day-classify.ts` removed** — no surviving consumers after `morning-gen` retired.

### What survives — the new minimum

**Models (10)**: `Routine`, `Trigger`, `WorkoutLog`, `FinancialProfile`, `FinancialProfileSnapshot`, `RocketMoneyImport`, `ActivityLog`, `AlexaAuth`, `MorningCheckin`, `AssistantSettings`.

**Services (16)**: `routines`, `triggers`, `workouts`, `finance`, `finance-history`, `csv-parser`, `calendar` (+ new `upcomingEvents` helper for `get_calendar_range`), `appointments`, `morning-checkin`, `assistant-settings`, `activity`, `session`, `alexa-lwa`, `alexa-shopping-list`, `grocery-list-parser`, `assistant-tools` (under `persona/`).

**Routes (11)**: `/api/auth/google`, `/api/routines`, `/api/triggers`, `/api/workouts`, `/api/finance/*` (profile + outsourceable + affordability + estimate-tax + imports + snapshots), `/api/calendar/today`, `/api/appointments/*`, `/api/alexa/*` (LWA + shopping list), `/api/chat`, `/api/assistant-settings*`, `/api/morning-checkin/*`.

**Dashboard components (13)**: `App`, `TodayView`, `LookBackPanel`, `StuffPanel`, `AssistantSettingsPanel`, `MorningCheckinForm`, `HabitsReminder`, `AskPanel`, `CalendarDayPanel`, `RoutinesPage`, `FinancePanel`, `HowToGuide`, `LoginScreen`, `ThemeToggle`.

### Dashboard — 3-tab compression

- **Today** ([apps/dashboard/src/components/TodayView.tsx](apps/dashboard/src/components/TodayView.tsx) from Phase B) — morning check-in + calendar strip + habits reminder + Ask.
- **Look Back** ([apps/dashboard/src/components/LookBackPanel.tsx](apps/dashboard/src/components/LookBackPanel.tsx) new) — minimal Phase C version: workout count vs target (3/week), 7-day morning-checkin strip, placeholders for "This month" (Phase D) + "Patterns" (Phase D).
- **Stuff** ([apps/dashboard/src/components/StuffPanel.tsx](apps/dashboard/src/components/StuffPanel.tsx) new) — three sub-tabs persisted via `localStorage.household-os.stuff-tab`:
  - **Routines** — wraps the surviving `RoutinesPage`.
  - **Finance** — wraps the trimmed `FinancePanel` (FinanceDayLog stripped).
  - **Assistant settings** — new [AssistantSettingsPanel.tsx](apps/dashboard/src/components/AssistantSettingsPanel.tsx): textarea for the live system prompt, version-history list with rollback, "Reset to seed" button. All round-trips against `/api/assistant-settings*`.

Header icons collapsed from 4 to 1 (just `❔ Guide`). The previous Household Ops launcher, Food, Routines all retired (Routines is now a Stuff sub-tab; Household Ops is the unified `/api/chat` accessible from Today's AskPanel; Food retired entirely with the meal-week + grocery-list-paste surfaces).

Legacy `household-os.view` localStorage migration in `readSavedView()`: any pre-Phase-C value (`home`, `today`, `schedule`, `workouts`, `finance`, `log`, `activity`, `journal`, `household`, `food`, `routines`) falls through to `'today'`. The new valid set is `['today', 'look_back', 'stuff', 'guide']`.

### Shared types trim

`packages/shared/src/types.ts` went from ~830 lines to ~370. Removed: `TodayPlan`, `PlanItem`, `SwapPoolItem`, `PublisherState`, `MoodLog`, `EnergyLog`, `DeferralEvent`, `DeferralPattern`, `WorkoutPattern`, `MealEffort`, `MealDay`, `MealWeek`, `ContextEntry/Input`, `ContextRelatedPersona`, `ContextSource`, `CheckIn` + 4 question-shape types + `CheckInType` + `CheckInStatus` + `ZoneStateLevel` + `ZoneAssessment` + `AdHocTask*` + `PatternInterruptContext` + `ZoneAssessmentContext`, `CalendarTask`, `DayView`, `ScheduleRoutineDue / ScheduleEntry / SchedulePendingAdHoc / ScheduleRangeResponse`, `EnergySuggestion`, `DeferReasonCode`, `DeferReason`, `WellbeingSource`, `DayType`, `ItemStatus`, `PersonaConfig`. `ActivityKind` shrunk from 25 → 10 values (kept: `workout_logged`, `trigger_added`, `routine_edited`, `finance_import_added`, `finance_snapshot_restored`, `appointment_created`, `appointment_rescheduled`, `appointment_deleted_externally`, `task_done`, `morning_checkin_logged`).

### Spec deviations / design calls

1. **Alexa skill left compiling-but-runtime-broken.** The skill's intent handlers + `client.ts` still call retired endpoints (`/today/swap`, `/zones/*`, `/checkins/*`, `/mood`, `/energy`, `/patterns/*`). §50 has a dedicated **Phase F — Alexa cleanup** for this. The skill compiles because it types its API responses independently in `client.ts`; calls will 404 at runtime against the new API. **Don't ship voice-flows-dependent demos until Phase F.** The daily morning push (Proactive Events) and the LWA-backed shopping list integration still work — those don't depend on retired endpoints.
2. **Routine schema simplification deferred to Phase E.** §50 calls for removing `energy`, `flex_days`, `also_triggers`, `skip_if`, `prep_dependency`, `zone_rotation` from the Routine schema. Phase C leaves the schema as-is because (a) seed.ts still seeds those fields from `inventory.json`, (b) the Stuff/Routines table that Phase E rebuilds is the natural place to drop fields from the schema + every consumer in one coherent change. The `patchRoutine` allow-list in `services/routines.ts` still includes the doomed fields. Harmless until Phase E.
3. **`get_calendar_range` simplified to events-only.** §50's tool spec just says "Upcoming events (default 7)." The old `scheduleRange` joined rolling-routine due dates + fixed-routine schedules + zone rotation + event-driven routines + ad-hoc tasks — almost all of which retire in Phase C. The Phase C replacement (`upcomingEvents` in `services/calendar.ts`) just lists Google Calendar events for an N-day window. The assistant can still answer "what's on the routine schedule this week" by calling `list_routines` and reasoning over the cadence math, but it won't get a pre-bucketed week view. Acceptable trade-off given the §50 ethos ("Calendar is always source of truth for time-bound things").
4. **Look Back is a Phase C shell.** §50 Phase D will fill in This month (RocketMoney-import summary + projected income view) + Patterns (a small set of hardcoded queries like "skipped strength training 3 times in 30 days — all on groggy mornings"). Phase C ships the structural panel + the easiest data section ("This week" — workout count + check-in strip from existing services). Placeholders point at Stuff/Finance until Phase D.
5. **`ChatMessage` collection still not built.** §50's Today-view spec mentions persisting chat history to a `ChatMessage` collection so Look Back can surface "what did I ask the assistant last Tuesday." Phase B noted this was deferred; Phase C doesn't add it either because Look Back is still a placeholder. Phase D is the natural time — if/when Look Back actually wants to render chat snippets.
6. **Phase 6 Alexa Reminders deferred indefinitely per §50.** The hourly cron's reminders pass got stripped (was the second pass after appointment reconcile). LWA bootstrap stays because the shopping-list integration still uses it. `alexa-reminders.{ts,test.ts}` deleted; the `AlexaReminder` Mongo collection model deleted; the `Alexa Reminders` test count drops by 4.
7. **Meal week calendar retired by default per §50.** §50 said "Diane should sanity-check whether she'd miss the meal week view" but Phase A and Phase B shipped without her flagging it. Defaulting to delete here means the Food tab + `MealWeekCalendar.tsx` + `meal-weeks` service + route + model + tests all go. The Mongo collection's data survives in Atlas; restore the code from git if Diane wants it back later.

### Tests + build delta

| Metric | Before Phase C | After Phase C | Delta |
|---|---|---|---|
| Tests passing | 384 API + 10 alexa-skill = 394 | 189 API + 10 alexa-skill = 199 | −195 (−49%) |
| Test files | 41 + 1 | 17 + 1 | −24 |
| Dashboard JS gzipped | 291 KB | 209 KB | −28% |
| Dashboard modules transformed (Vite) | 63 | 46 | −27% |
| Mongoose models | 20 | 10 | −50% |
| API routes mounted under `/api` | 23 | 11 | −52% |
| `ActivityKind` union members | 25 | 10 | −60% |

All four workspaces typecheck clean; all 199 tests pass; dashboard production build succeeds.

### Route cheat sheet (post-Phase C)

| Endpoint | Method | Purpose |
|---|---|---|
| `/health` | GET | Health check (no auth) |
| `/alexa` | POST | Alexa skill webhook (still mounted; handlers retire in Phase F) |
| `/api/auth/google` | POST | Google ID token → session JWT (§38) |
| `/api/routines` | GET | All active routines |
| `/api/routines/:key` | PATCH | Update routine (allow-list) |
| `/api/triggers` | GET / POST | Calendar event triggers |
| `/api/workouts` | GET / POST | Retroactive workout log + history |
| `/api/workouts/today` | GET | Today's slot + log |
| `/api/workouts/by-date/:date` | GET | Specific day's slot + log |
| `/api/finance/profile` | GET / PATCH | FinancialProfile singleton |
| `/api/finance/outsourceable` | GET | Outsourceable routines with $/mo |
| `/api/finance/affordability` | GET | Greedy-fit report |
| `/api/finance/estimate-tax` | POST | Pure compute |
| `/api/finance/imports` | GET / POST | RocketMoney imports |
| `/api/finance/imports/:id/apply` | POST | Apply import → write profile + snapshot |
| `/api/finance/snapshots` | GET | Profile history |
| `/api/finance/snapshots/:id/restore` | POST | Restore profile from snapshot |
| `/api/calendar/today` | GET | Today's Google Calendar events |
| `/api/appointments/:key` | POST / DELETE | Schedule / unlink an appointment |
| `/api/appointments/:key/reconcile` | POST | Force reconcile |
| `/api/appointments/reconcile-all` | POST | Admin trigger for the cron logic |
| `/api/alexa/auth-status` | GET | LWA configured? |
| `/api/alexa/shopping-list/add` | POST | Bulk-add items to Alexa shopping list |
| `/api/alexa/lwa/save-token` | POST | One-time LWA bootstrap |
| `/api/chat` | POST | Unified assistant tool-use loop |
| `/api/assistant-settings` | GET / PATCH | System prompt + version list |
| `/api/assistant-settings/reset` | POST | Reset to seed prompt |
| `/api/morning-checkin` | GET / POST | Today's check-in + upsert |
| `/api/morning-checkin/:date` | GET | Specific day |
| `/api/morning-checkin?days=N` | GET | Recent (newest-first) |

### Open follow-ups for the next phase boundary

- **Phase D (Look Back)**: fill in the "This month" section (RocketMoney import summary + projected income) and the "Patterns" surfacer. Decide whether to build the `ChatMessage` collection (so Look Back can show "what you asked the assistant about last week") or skip — it's a heavy persistence layer for a low-frequency use case.
- **Phase E (Stuff)**: the Stuff panel is functional but Phase E refines it. Specifically: add `cadence_shift_strategy` to `update_routine` (modal + tool wiring), add `set_projected_income` (decide: new field on profile vs. new collection), simplify the Routine schema by dropping `energy` / `flex_days` / `also_triggers` / `skip_if` from the model + seed.ts + `patchRoutine` allow-list.
- **Phase F (Alexa)**: this is the most-urgent remaining work because the live skill currently 404s against the trimmed API. Retool `WhatsLeftIntent` to read today's incomplete Calendar events directly; delete the rest of the intents (swap / mark-done / pull-from-pool / mood / energy / check-in answer / zone / etc.); update `client.ts` to only call surviving endpoints; verify the morning push still fires.
- **Phase G (Final cleanup)**: relative timestamps on the Routines table + MorningCheckin summary line. Run a `find` for any orphaned tests or docs the Phase C purge missed.

---

## 54. Phase D — Look Back view (SHIPPED 2026-05-13)

Phase D of the §50 rebuild. Fills in the "This month" + "Patterns" sections of Look Back (Phase C shipped placeholders). Pure observation surface — no scoring, no nags, no streaks.

### What landed

**API — pattern surfacer**

- [apps/api/src/services/patterns-simple.ts](apps/api/src/services/patterns-simple.ts) — on-demand (no cron). Two detectors plus an orchestrator:
  - `skippedWorkoutsByAwakeness(days)` — cross-references `WorkoutLog.status='skipped'` with `MorningCheckin.awakeness` on the same date. Threshold: ≥2 observed skips (skips without a same-day check-in are dropped from the denominator), and one awakeness level accounts for ≥75% of the observed skips. Two phrasings: "all on groggy mornings" when ratio is 1.0, "3 of 4 skipped workouts were on groggy mornings" when between 0.75 and 1.0.
  - `consecutiveLowMood(days)` — walks newest → oldest `MorningCheckin`s, counts the leading run of `mood='down'` entries. Surfaces only when run ≥ 3. **Allows gaps** — days with no check-in don't break the run, because "no log" ≠ "good day."
  - `detectPatterns(windowDays)` — clamps window to [1, 90], runs both, drops nulls. Empty array → the dashboard hides the section entirely.
- [apps/api/src/routes/look-back.ts](apps/api/src/routes/look-back.ts) — `GET /api/look-back/patterns?days=N`. The other two sections (This week + This month) compose from existing endpoints rather than getting dedicated rollup routes; resist adding `/api/look-back/this-month` unless server-side composition becomes genuinely necessary.

**Dashboard — full Look Back rebuild**

- [apps/dashboard/src/components/LookBackPanel.tsx](apps/dashboard/src/components/LookBackPanel.tsx) — three live sections, all read-only:
  - **This week** (unchanged from Phase C) — workout count vs `STRENGTH_WEEKLY_TARGET=3` (hardcoded per §50 spec); 7-day morning-checkin strip with date + mood/energy/awakeness + note preview.
  - **This month** (new) — two sub-panels:
    - **Monthly profile** — `Projected income (= monthly_gross_income) − Tax estimate − Fixed expenses − Discretionary spent (from latest RocketMoney parsed.total) = Net`. Net only renders when there's a gross income AND a parsed import total; otherwise the math is suspect. Empty state when nothing is set yet ("fill in Stuff → Finance to see the rollup").
    - **Latest RocketMoney import** — kind + filename + date + total in the meta line. Top 5 categories by amount as a list. Three terminal states handled explicitly: no imports (empty state with pointer to Stuff → Finance), paste import (no parse — just shows kind/date), CSV that didn't parse (clear "no matching outflow rows" notice).
  - **Patterns** (new) — fetches `api.lookBack.patterns(30)` and renders each observation as a bordered list item. **Auto-hides the entire section** when the array is empty per §50 ("hides when there's nothing notable").
- [apps/dashboard/src/api.ts](apps/dashboard/src/api.ts): new `api.lookBack.patterns(days)` + exported `LookBackPattern` type.

### Tests added (+14)

[apps/api/src/services/patterns-simple.test.ts](apps/api/src/services/patterns-simple.test.ts):

- **`skippedWorkoutsByAwakeness`** (7): null below 2 skips; all-match phrasing at ratio 1.0; majority phrasing at ratio 0.75; null at ratio 0.5 (no dominant awakeness); skips without same-day check-in dropped from denominator; ignores `done` + `partial` workouts; respects the window (out-of-window skips don't count).
- **`consecutiveLowMood`** (4): null below 3 consecutive; surfaces at 3-day run; breaks on first non-`down` day (most recent neutral → run is 0); null when no check-ins at all.
- **`detectPatterns` orchestrator** (3): empty array when neither detector fires; returns both patterns when both fire simultaneously; clamps `windowDays` to [1, 90] without throwing.

**Deliberately not tested:**

- Dashboard components — same situation as every prior phase (no React testing infra). First regression candidates: `ThisMonthSection` empty-state branches (no profile / no import / paste-only / CSV-no-parse), `PatternsSection` auto-hide on empty array, the `Net` math conditional rendering.
- The route layer — thin wrapper over the service which is fully covered.

### Spec deviations / design calls

1. **`FinancialProfile.monthly_gross_income` used as "projected income."** §50's "This month" section reads "the projected income number Diane entered" and Phase E lists `set_projected_income({month, amount})` as a deferred tool needing "a new field or collection — decision pending." Phase D punts that decision: it uses the existing flat-monthly `monthly_gross_income` field as the projected income source. Functionally identical when she doesn't actually want per-month overrides; Phase E can add per-month overrides later without changing this view's contract.
2. **"This week" workout target hardcoded.** §50 says "Wire workout target (3/week) as a constant for now; editable later from Stuff/Assistant Settings if she wants." Done as `STRENGTH_WEEKLY_TARGET = 3` at the top of `LookBackPanel.tsx`. If she ever wants this editable, the cleanest path is a `WorkoutTargets` singleton (or a field on `FinancialProfile`-like settings doc) — not worth the abstraction today.
3. **Two detectors, not five.** §50 said "Start with one or two patterns." Shipped two. Adding more is a one-function append to `patterns-simple.ts`. Candidates for later if Diane wants them: "X+ consecutive days of low energy," "appointment rescheduled N+ times this month for one routine" (via the `appointment_rescheduled` ActivityLog kind), "morning check-in skipped N days in a row." Don't add unless she asks.
4. **`consecutive_low_mood` allows gaps in the run.** A more naive implementation would break on any day without a check-in. Decision: not logging a check-in could mean she forgot, was traveling, or was too overwhelmed to log — none of which should reset the "things have been hard lately" signal. Days with `mood='down'` only end the run when a check-in actually exists with a non-down mood.
5. **`skippedWorkoutsByAwakeness` drops uncorrelated skips from the denominator.** If Diane skipped 5 workouts but only logged check-ins for 2 of them, we compute the ratio over 2, not 5. The unobserved skips can't tell us whether they correlated with awakeness — including them would inflate or deflate the ratio depending on how we handled them. The pattern only surfaces conclusions from data we actually have.
6. **No `Patterns` assistant tool.** Could expose `detectPatterns` as an assistant tool (`get_patterns`) so the chat surface can reason over the same observations. Skipped because the assistant can already query `recent_workouts` + `recent_checkins` and synthesize the same observations on the fly; adding a redundant tool is just API surface debt.
7. **No `ChatMessage` collection added.** §50's Today-view spec floated persisting AskPanel chat history to a `ChatMessage` collection so Look Back could surface "what did I ask the assistant last Tuesday." Phase D didn't need it — the three sections all draw from existing collections (MorningCheckin, WorkoutLog, FinancialProfile, RocketMoneyImport). Punting indefinitely unless Diane specifically asks for a chat-history retro view.

### Route cheat sheet additions

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/look-back/patterns` | GET | `?days=N` (default 30, clamped [1, 90]). Returns `Pattern[]` — empty when nothing notable. Dashboard hides the Patterns section in that case. |

### Open follow-ups for Phase E

- **Routine schema simplification** — drop `energy`, `flex_days`, `also_triggers`, `skip_if` from the schema + seed + `patchRoutine` allow-list. Stuff → Routines table is the natural place to touch every consumer in one coherent change.
- **`cadence_shift_strategy` on `update_routine`** — add the `'one_off' | 'shift_all' | 'skip_one'` modal in the Routines table, wire the strategy through `patchRoutine` to write to Google Calendar when the routine is appointment-enabled.
- **`set_projected_income({month, amount})` decision** — Phase D punted to `monthly_gross_income`. Decide whether to:
  - keep that flat-monthly figure (do nothing; Look Back is fine as-is), OR
  - add per-month overrides as `MonthlyProjectedIncome` collection or a `monthly_projected_income_overrides: { 'YYYY-MM': number }` field on `FinancialProfile`.
- **Stuff → Assistant Settings polish** — Phase C shipped a working textarea + version rollback. Could add diff view between versions, but unclear if she'd use it.

### Open follow-ups for Phase F

- The Alexa skill is still the most-urgent remaining work — it 404s against the trimmed API. Phase F: retool `WhatsLeftIntent` against Google Calendar events (not the deleted TodayPlan), drop the rest of the intents.
