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

**Current test status: 307 tests across 32 files (297 API + 10 alexa-skill). Typecheck clean across all four workspaces (`shared`, `api`, `dashboard`, `alexa-skill`).**

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
4. **`npm test` should pass 307 tests across 32 files** (297 API + 10 alexa-skill). `npm run typecheck` should be clean across all 4 workspaces.
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
| `/api/meal-weeks` | GET / POST | List newest-first / upsert by `start_date` (§48) |
| `/api/meal-weeks/by-date/:date` | GET | Find the meal week containing any day |
| `/api/meal-weeks/:start_date` | GET / DELETE | Exact week / remove by Monday-of-week |
| `/api/meal-weeks/:start_date/adjacent` | GET | Nearest stored prev + next weeks for nav |
| `/api/appointments/:routine_key` | POST / DELETE | Schedule a calendar appointment / unlink it (§47 Phase 4) |
| `/api/appointments/:routine_key/reconcile` | POST | Force reconcile against Google Calendar |
| `/api/appointments/reconcile-all` | POST | Admin trigger for the hourly cron logic |

---

## 46. Latest test count + coverage delta (running tally)

As of 2026-05-10 end-of-day, post-Phase 4 + persona Project URL hardcoding: **307 tests across 32 files** (297 API + 10 alexa-skill). Was 251 pre-Phase 1, dropped to 247 after Phase 1 cleanup, 263 after Phase 2 data-model tests, 285 after §48 meal-weeks, 303 after Phase 4 appointments, 307 after persona URL hardcoding. Phase 3 was UI-only and didn't move the count.

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

### Phase 5 — RocketMoney workflow: paste + CSV + history (~2-3 hr)

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

### Phase 6 — Alexa: Reminders + Shopping List + WhatsLeftIntent (~4-6 hr)

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

