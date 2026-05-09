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
