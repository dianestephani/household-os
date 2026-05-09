# household-os

Diane's "Household Ops" assistant — a single-user system that knows her recurring routines, generates a daily plan sized to her available energy, and surfaces it via dashboard, Alexa, and Google Calendar.

See [HANDOFF.md](./HANDOFF.md) for the full design and architecture.

## Quick start

```bash
# 1. install
npm install

# 2. fill out env
cp .env.example .env
# (edit .env — at minimum: MONGO_URL, API_TOKEN, ANTHROPIC_API_KEY)

# 3. run mongo locally (or point MONGO_URL at Atlas)
brew services start mongodb-community  # mac

# 4. seed routines from inventory.json
npm run seed

# 5. start the api
npm run dev:api

# 6. (separate shell) start the dashboard
npm run dev:dashboard
```

## Layout

- `packages/shared/` — shared types, persona configs, seed inventory
- `apps/api/` — Express + Mongoose + cron + publisher + persona chat
- `apps/dashboard/` — React + Vite frontend
- `apps/alexa-skill/` — Alexa custom skill (intent handlers)

## Build order

Following §15 of HANDOFF.md. After step 7 (Publisher), the system is genuinely useful even without the dashboard / Alexa.
