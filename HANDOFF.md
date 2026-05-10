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

# Part B — Post-v1 update (current as of 2026-05-09)

> **Reading instructions for a fresh Claude instance:** §1–§17 above is the original v1 design doc. Everything in this Part B reflects what has actually been built and changed since the v1 scaffold. When the design doc and this section disagree, **trust this section** — the design doc is historical. Diane wants you to be fully caught up before you write any code. Don't re-do the original §15 build order; it's done.

## 18. State of the system

The v1 plan is shipped and the system is running. The API is on Render (Starter $7/mo); MongoDB lives on Atlas free tier; the dashboard is also on Render as a free static site; the Alexa skill is mounted on the API at `POST /alexa` via `ask-sdk-express-adapter`. There's no separate Lambda. Google Calendar OAuth is wired and working. 158 tests pass green; typecheck is clean across all four workspaces (`shared`, `api`, `dashboard`, `alexa-skill`).

The for-end-user reference is the **in-app Guide tab** (Dashboard → ❔ Guide); this HANDOFF is just for engineers/Claude.

## 19. Personas — current truth

The original §11 plan said Household Ops would be the only live persona, with Nutrition and Finance as stubs. That's no longer true:

| Persona | Status | Why it matters |
|---|---|---|
| **Household Ops** | Live | Same as v1 |
| **Finance** | Live (full tools) | Helps Diane decide what to outsource and answer "can I afford X" |
| **Nutrition** | Still stub | Diane explicitly deprioritized; "Diane is starting with Household Ops; nutrition comes later" is the canned reply |

Both live personas use Claude Opus 4.7 (`claude-opus-4-7`) with prompt caching on system prompt + tool definitions. Both have `log_context` and `recent_context` tools and call `recent_context` at the start of every conversation (see §22).

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

## 30. How a fresh Claude should pick up

1. Read this whole HANDOFF (Part A for design, Part B for current truth).
2. `git status` + `git log --oneline -20` to see what's been touched recently.
3. `npm test` should be green (178 tests). `npm run typecheck` should be clean.
4. Ask Diane what she wants to work on. Default to small, contained changes — she has the hyperfixate-burnout pattern noted in §1, so don't propose multi-week refactors unprompted.
5. If she shares qualitative context in conversation, log it via the journal — `POST /api/context` directly. Don't lose context to a session boundary.
6. The end-user reference is the **Dashboard → ❔ Guide tab**. If Diane asks "how do I X" and the answer is in there, point her at it before re-explaining.

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

Three panels per persona:

1. Name + one-line blurb + primary "Open in Claude.ai →" button. The button uses a **saved Claude Project URL** (per-persona, persisted in `localStorage` under `persona-project-url-<name>`); falls back to `https://claude.ai/new` if no URL is saved yet.
2. "Saved Claude Project URL" input with one-time setup instructions (create a Claude Project, paste system prompt into Project instructions, save Project URL here).
3. The full system prompt rendered in a scrollable `<pre>` with a "Copy" button (`navigator.clipboard.writeText`, fallback to `Selection` API). Includes a heads-up that the prompt references tools that won't exist on claude.ai.

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

### UX choice: sessionStorage, not localStorage

The user asked for "login every time I click the link" behavior. `sessionStorage` clears when the tab closes, which gives that without us needing aggressive short JWT expiries or refresh-token plumbing. JWT itself is 24h so a long-lived tab doesn't get bounced mid-session.

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

## 36. Route cheat sheet (current as of this Part B)

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/today`, `/today/regenerate`, `/today/swap`, `/today/mark-done`, `/today/pull-from-pool` | GET / POST | Same as v1 |
| `/api/routines`, `/api/routines/:key` | GET / PATCH | |
| `/api/energy`, `/api/mood` | POST | |
| `/api/workouts/today`, `/api/workouts` | GET / POST | |
| `/api/zones`, `/api/zones/assess`, `/api/zones/tasks` | various | |
| `/api/checkins/pending`, `/api/checkins/:id/answer`, `…/skip` | various | |
| `/api/triggers` | GET / POST | |
| `/api/patterns/deferrals`, `/api/patterns/workouts` | GET | |
| `/api/activity` | GET | |
| `/api/finance/profile`, `/api/finance/outsourceable`, `/api/finance/affordability`, `/api/finance/estimate-tax` | GET / PATCH / POST | |
| `/api/context`, `/api/context/today` | GET / POST | journal |
| **`/api/calendar/today`** | **GET** | **new — today's Google Calendar events normalized for the dashboard** |
| **`/api/schedule?days=N`** | **GET** | **new — week / month look-ahead, calendar events + routines coming due** |
| `/api/chat/:persona` | POST | Persona chat (still wired backend-side; no longer hit from the UI) |
| `/alexa` | POST | Alexa webhook |

