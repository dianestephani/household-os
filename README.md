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

## Deploying the API to Render

Render hosts the API (Express + cron + Alexa webhook). MongoDB lives separately on Atlas free tier. The dashboard can stay local — only the API needs to be public so Alexa can reach it.

Cost: **$7/mo** (Render Starter Web Service) + **$0** (Mongo Atlas free tier).

The free Render tier won't work — it sleeps after 15 min idle, which breaks every cron job (morning-gen, calendar-ingest, check-in generators).

### One-time setup (~20 minutes)

1. **MongoDB Atlas free tier**
   - Sign up at [mongodb.com/atlas](https://mongodb.com/atlas) → create a free M0 cluster (any region near you).
   - Database Access → add user with read/write to any database; save the password.
   - Network Access → add IP `0.0.0.0/0` (Render's IPs aren't fixed; or use Render's outbound IPs if you want stricter).
   - Connect → Drivers → copy the connection string. Replace `<password>` and append your db name (`household_os`) — it'll look like `mongodb+srv://<user>:<password>@cluster0.xxxxx.mongodb.net/household_os?retryWrites=true&w=majority`

2. **Push your repo to GitHub** (you've already done this — make sure `master` is current).

3. **Render account + Blueprint deploy**
   - Sign up at [render.com](https://render.com) → connect your GitHub.
   - **New +** → **Blueprint** → pick the `household-os` repo → Render reads [render.yaml](./render.yaml) and proposes the service.
   - Fill in the secret env vars Render prompts for:
     - `MONGO_URL` — your Atlas connection string from step 1
     - `API_TOKEN` — generate a long random string (`openssl rand -hex 32`); the Alexa skill's `HOUSEHOLD_API_TOKEN` and the dashboard's `VITE_API_TOKEN` need to match this
     - `ANTHROPIC_API_KEY` — `sk-ant-...`
     - `ALEXA_SKILL_ID`, `ALEXA_CLIENT_ID`, `ALEXA_CLIENT_SECRET` — from the Alexa Developer Console (only LWA pair is needed if you want proactive push)
   - Click **Apply**. Render builds + deploys (~3-5 minutes).
   - Note the assigned URL — `https://household-os-api.onrender.com` or similar.

4. **Seed the production database** (one-time)
   - Locally, set `MONGO_URL` in your shell to the Atlas connection string and run `npm run seed`.
   - Or use the Render Shell to run `npm run seed` against the deployed instance.

5. **Repoint Alexa**
   - Alexa Developer Console → your skill → Build → Endpoint → replace your ngrok URL with `https://household-os-api.onrender.com/alexa` → Save → Build Model.
   - Tunnel can be killed (`kill $(lsof -ti :4040)`); you don't need ngrok anymore.

### Updating

Push to `master` → Render auto-deploys. Logs in the Render dashboard show stdout/stderr from the API + cron events.

### Costs after the first month

| Service            | Tier                          | Monthly         |
| ------------------ | ----------------------------- | --------------- |
| Render Web Service | Starter (always-on)           | $7              |
| MongoDB Atlas      | M0 (free, 512 MB)             | $0              |
| Anthropic API      | pay-per-use, persona chat only| ~$0–2 (typical) |
| **Total**          |                               | **~$7–9**       |

The dashboard (`apps/dashboard`) can stay local indefinitely. If you ever want it hosted, add a `static_site` entry to [render.yaml](./render.yaml) — happy to set that up.
