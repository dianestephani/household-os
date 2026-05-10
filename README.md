# household-os

Diane's "Household Ops" assistant — a single-user system that knows her recurring routines, generates a daily plan sized to her available energy, and surfaces it via dashboard, Alexa, and Google Calendar.

The original v1 design lives in [HANDOFF.md](./HANDOFF.md). This README covers what's actually shipped — including everything we've built since the v1 scaffold.

For end-user docs (every voice command, every dashboard tab, every cron job, every privacy boundary), open the dashboard and click the **❔ Guide** tab in the top-right of the nav. That's the canonical reference; this README is just for orientation + setup.

## What's in here

```text
household-os/
  packages/shared/       — types + seed inventory + persona configs
  apps/api/              — Express + Mongoose + cron + publisher + persona chat + Alexa webhook
  apps/dashboard/        — React + Vite frontend (incl. the in-app How-to Guide)
  apps/alexa-skill/      — Alexa custom skill (handlers, interaction model, deploy docs)
  render.yaml            — Render Blueprint for one-click prod deploy
```

The skill is mounted on the API server via `ask-sdk-express-adapter`, so deploying the API also deploys the skill (`POST /alexa`).

## Subsystems shipped

| Subsystem | Where it lives |
| --- | --- |
| **Daily plan generation** (rolling routines, fixed routines, zone rotation, event-driven triggers, skip_if + also_triggers, budget packing) | [apps/api/src/cron/morning-gen.ts](apps/api/src/cron/morning-gen.ts) |
| **Calendar trigger ingestion** (Airbnb, dogsit, landscaper, cleaner) | [apps/api/src/cron/calendar-ingest.ts](apps/api/src/cron/calendar-ingest.ts) |
| **Publisher** (debounced fan-out to Google Calendar + Alexa app cards) | [apps/api/src/publisher/](apps/api/src/publisher/) |
| **Mood + energy logging** | [apps/api/src/services/mood.ts](apps/api/src/services/mood.ts), [apps/api/src/services/energy.ts](apps/api/src/services/energy.ts) |
| **Workouts module** (today's slot, log status, history) | [apps/api/src/services/workouts.ts](apps/api/src/services/workouts.ts) |
| **Zone assessments → ad-hoc tasks** (rotates 1 zone per day, severity + age priority) | [apps/api/src/services/zones.ts](apps/api/src/services/zones.ts) |
| **Check-in system** (morning intent / evening retro / weekly review / pattern interrupts / zone assessments) | [apps/api/src/services/checkins.ts](apps/api/src/services/checkins.ts), [apps/api/src/services/checkin-generators.ts](apps/api/src/services/checkin-generators.ts) |
| **Pattern detection** (frequent deferrals, missed workout streaks) | [apps/api/src/services/patterns.ts](apps/api/src/services/patterns.ts) |
| **Persistent activity log** (unified timeline, all events) | [apps/api/src/services/activity.ts](apps/api/src/services/activity.ts) |
| **Persona chat** (Household Ops via Claude Opus 4.7 + tool use + prompt caching; Nutrition + Finance stubs) | [apps/api/src/persona/](apps/api/src/persona/), [packages/shared/src/personas/](packages/shared/src/personas/) |
| **Alexa skill** (15 voice intents + multi-turn morning check-in + proactive app cards) | [apps/alexa-skill/](apps/alexa-skill/) |
| **Dashboard** (Today, Workouts, Activity, persona tabs, Routines editor, How-To Guide) | [apps/dashboard/](apps/dashboard/) |

## Quick start (local)

```bash
# 1. install
npm install

# 2. environment
cp .env.example .env
# (edit .env — at minimum: MONGO_URL, ANTHROPIC_API_KEY. API_TOKEN can be empty for local dev.)

# 3. local mongo
brew services start mongodb-community

# 4. seed the 18 routines from inventory.json
npm run seed

# 5. API + dashboard in two shells
npm run dev:api          # :3000
npm run dev:dashboard    # :5173 (proxies /api → :3000)
```

Open <http://localhost:5173>. The Today tab is the landing page. The **❔ Guide** tab in the top nav has the full how-to.

## Tests

```bash
npm test                 # all workspaces — currently 122 tests
npm run typecheck        # all workspaces
```

API tests use a separate `household_os_test` database on local Mongo (set via `MONGO_TEST_URL` if you want to override).

## Voice / Alexa

Setup, deployment paths, intent reference, and troubleshooting all live in [apps/alexa-skill/README.md](apps/alexa-skill/README.md). Short version: the skill is mounted on the API as `POST /alexa`. Use ngrok for dev, or skip ngrok entirely once the API is on Render.

## Deploying to Render

Render hosts the API (Express + cron + Alexa webhook). MongoDB lives separately on Atlas free tier. The dashboard can stay local — only the API needs to be public so Alexa can reach it.

**Cost:** ~$7/mo (Render Starter Web Service) + $0 (Mongo Atlas free tier) + ~$0–2/mo Anthropic API.

> The free Render tier won't work for this project — it sleeps after 15 min idle, which breaks every cron job (morning-gen, calendar-ingest, check-in generators). Starter ($7/mo) keeps the process always-on.

### One-time setup (~20 minutes)

1. **MongoDB Atlas free tier**
   - Sign up at [mongodb.com/atlas](https://mongodb.com/atlas) → create a free M0 cluster.
   - Database Access → add user with read/write to any database; save the password.
   - Network Access → add IP `0.0.0.0/0` (Render IPs aren't fixed).
   - Connect → Drivers → copy the connection string. Replace `<password>` and **append `/household_os`**:
     `mongodb+srv://<user>:<password>@cluster0.xxxxx.mongodb.net/household_os?retryWrites=true&w=majority`

2. **Render account + Blueprint deploy**
   - Sign up at [render.com](https://render.com) → connect your GitHub.
   - **New +** → **Blueprint** → pick the `household-os` repo → Render reads [render.yaml](./render.yaml) and proposes the service.
   - Fill in the secret env vars Render prompts for:
     - `MONGO_URL` — your Atlas connection string (must end with `/household_os?...`)
     - `API_TOKEN` — `openssl rand -hex 32` (optional; leave blank for no auth on a single-user system)
     - `ANTHROPIC_API_KEY` — `sk-ant-...`
     - `ALEXA_SKILL_ID`, `ALEXA_CLIENT_ID`, `ALEXA_CLIENT_SECRET` — from the Alexa Developer Console (LWA pair only needed for proactive app-card push)
   - Click **Apply**. Render builds + deploys (~3-5 minutes).

3. **Seed the production database**
   - Locally: `MONGO_URL='<your atlas string>' npm run seed` → `seeded 18 routines`.
   - Or run `npm run seed` from the Render Shell.

4. **Repoint Alexa**
   - Alexa Developer Console → your skill → Build → Endpoint → swap your ngrok URL for `https://<your-render-url>.onrender.com/alexa` → Save → Build Model.
   - Kill ngrok locally; you don't need it anymore.

### Updating

Push to `master` → Render auto-deploys. Logs are in the Render dashboard.

### Costs after first month

| Service            | Tier                            | Monthly         |
| ------------------ | ------------------------------- | --------------- |
| Render Web Service | Starter (always-on)             | $7              |
| MongoDB Atlas      | M0 (free, 512 MB)               | $0              |
| Anthropic API      | pay-per-use, persona chat only  | ~$0–2 (typical) |
| **Total**          |                                 | **~$7–9**       |

If you ever want the dashboard hosted too, add a `static_site` entry to [render.yaml](./render.yaml).

## Project memory + docs

- [HANDOFF.md](./HANDOFF.md) — the original v1 design doc. Architectural and historical context.
- [apps/alexa-skill/README.md](apps/alexa-skill/README.md) — Alexa setup, intent reference, deployment alternatives.
- **In-app Guide** (Dashboard → ❔ Guide tab) — every voice command, every dashboard tab, every cron job, every privacy boundary. The canonical user-facing reference.
