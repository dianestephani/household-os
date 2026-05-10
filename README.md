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
| **Schedule preview** (week / month look-ahead — calendar events + routines coming due, deterministic earliest-due-day bucketing, pending ad-hoc tasks) | [apps/api/src/services/schedule.ts](apps/api/src/services/schedule.ts), [apps/api/src/routes/schedule.ts](apps/api/src/routes/schedule.ts), [apps/dashboard/src/components/SchedulePanel.tsx](apps/dashboard/src/components/SchedulePanel.tsx) |
| **Day navigator** (Today tab is now date-aware — prev/next + native date picker; today is fully mutable, past days show stored plan read-only, future days show forecast from schedule logic; calendar events + that day's journal entries always shown) | [apps/api/src/services/day.ts](apps/api/src/services/day.ts), [apps/api/src/routes/day.ts](apps/api/src/routes/day.ts), [apps/dashboard/src/components/DayPanel.tsx](apps/dashboard/src/components/DayPanel.tsx) |
| **Calendar (today's events)** (passthrough to Google Calendar with normalized event shape, click-through to event + day permalinks) | [apps/api/src/services/calendar.ts](apps/api/src/services/calendar.ts), [apps/api/src/routes/calendar.ts](apps/api/src/routes/calendar.ts), [apps/dashboard/src/components/CalendarDayPanel.tsx](apps/dashboard/src/components/CalendarDayPanel.tsx) |
| **Calendar trigger ingestion** (Airbnb, dogsit, landscaper, cleaner) | [apps/api/src/cron/calendar-ingest.ts](apps/api/src/cron/calendar-ingest.ts) |
| **Publisher** (debounced fan-out to Google Calendar + Alexa app cards) | [apps/api/src/publisher/](apps/api/src/publisher/) |
| **Mood + energy logging** | [apps/api/src/services/mood.ts](apps/api/src/services/mood.ts), [apps/api/src/services/energy.ts](apps/api/src/services/energy.ts) |
| **Workouts module** (today's slot, log status, history) | [apps/api/src/services/workouts.ts](apps/api/src/services/workouts.ts) |
| **Zone assessments → ad-hoc tasks** (rotates 1 zone per day, severity + age priority) | [apps/api/src/services/zones.ts](apps/api/src/services/zones.ts) |
| **Check-in system** (morning intent / evening retro / weekly review / pattern interrupts / zone assessments) | [apps/api/src/services/checkins.ts](apps/api/src/services/checkins.ts), [apps/api/src/services/checkin-generators.ts](apps/api/src/services/checkin-generators.ts) |
| **Pattern detection** (frequent deferrals, missed workout streaks) | [apps/api/src/services/patterns.ts](apps/api/src/services/patterns.ts) |
| **Persistent activity log** (unified timeline, all events incl. `context_logged`) | [apps/api/src/services/activity.ts](apps/api/src/services/activity.ts) |
| **Finance module** (gross-income profile, 2025 federal/FICA/state tax estimator, outsourceable monthly cost rollup, greedy-fit affordability report, RocketMoney free-text breakdown) | [apps/api/src/services/finance.ts](apps/api/src/services/finance.ts), [apps/api/src/routes/finance.ts](apps/api/src/routes/finance.ts), [apps/dashboard/src/components/FinancePanel.tsx](apps/dashboard/src/components/FinancePanel.tsx) |
| **Context journal** (shared narrative log for both personas; free-form text + structured `dogsit_count` / `energy` / `mood` / `blocked_activities` / `tags` / `related_persona`) | [apps/api/src/services/context.ts](apps/api/src/services/context.ts), [apps/api/src/routes/context.ts](apps/api/src/routes/context.ts), [apps/dashboard/src/components/JournalPanel.tsx](apps/dashboard/src/components/JournalPanel.tsx) |
| **Persona launchers** (Household Ops + Finance — system-prompt copy + per-persona Claude Project URL persisted in localStorage; opens in claude.ai instead of running in-dashboard chat, so no Anthropic API key is required) | [apps/dashboard/src/components/PersonaLauncher.tsx](apps/dashboard/src/components/PersonaLauncher.tsx), [packages/shared/src/personas/](packages/shared/src/personas/) |
| **Persona API chat** (kept for completeness — Household Ops + Finance both have full tool definitions and runner; not currently wired to the dashboard UI but the route exists at `/api/chat/:persona` for re-enabling later) | [apps/api/src/persona/](apps/api/src/persona/) |
| **Alexa skill** (15 voice intents + multi-turn morning check-in + proactive app cards) | [apps/alexa-skill/](apps/alexa-skill/) |
| **Theme + typography** (light/dark toggle persisted in localStorage with prefers-color-scheme fallback, Inter body + Fraunces display from Google Fonts, strict-grayscale palette + muted semantic colors) | [apps/dashboard/src/styles.css](apps/dashboard/src/styles.css), [apps/dashboard/src/components/ThemeToggle.tsx](apps/dashboard/src/components/ThemeToggle.tsx), [apps/dashboard/index.html](apps/dashboard/index.html) |
| **Google sign-in wall** (Google Identity Services button on the dashboard, email allowlist, short-lived signed-JWT session in `sessionStorage` so the user re-auths on every fresh tab; API middleware accepts either the legacy `API_TOKEN` *or* a valid session JWT) | [apps/dashboard/src/components/LoginScreen.tsx](apps/dashboard/src/components/LoginScreen.tsx), [apps/dashboard/src/auth.ts](apps/dashboard/src/auth.ts), [apps/api/src/services/session.ts](apps/api/src/services/session.ts), [apps/api/src/middleware/auth.ts](apps/api/src/middleware/auth.ts), [apps/api/src/routes/auth.ts](apps/api/src/routes/auth.ts) |
| **Dashboard** (Today + Calendar strip + Context strip, Schedule, Workouts, Activity, Household Ops launcher, Finance, Routines editor, Journal, How-To Guide) | [apps/dashboard/](apps/dashboard/) |

## Quick start (local)

```bash
# 1. install
npm install

# 2. environment
cp .env.example .env
cp apps/dashboard/.env.example apps/dashboard/.env
# (edit .env — at minimum: MONGO_URL. API_TOKEN can be empty for local dev.
#  ANTHROPIC_API_KEY is no longer required — persona chat happens on claude.ai now.
#  GOOGLE_CALENDAR_* envs only needed if you want calendar/trigger ingestion.
#  GOOGLE_OAUTH_CLIENT_ID + AUTH_ALLOWED_EMAIL + JWT_SECRET only needed if you
#  want the Google login wall — leave blank locally to skip auth entirely.)

# 3. local mongo
brew services start mongodb-community

# 4. seed the 48 routines from inventory.json
npm run seed

# 5. (one-time) backdate every rolling routine so nothing is overdue and
#    the first occurrences are spread naturally across each cadence cycle
npm -w @household-os/api run start-tomorrow

# 6. API + dashboard in two shells
npm run dev:api          # :3000
npm run dev:dashboard    # :5173 (proxies /api → :3000)
```

Open <http://localhost:5173>. The Today tab is the landing page. The **❔ Guide** tab in the top nav has the full how-to.

## Tests

```bash
npm test                 # all workspaces — currently 201 tests (191 API + 10 alexa-skill)
npm run typecheck        # all workspaces
```

API tests use a separate `household_os_test` database on local Mongo (set via `MONGO_TEST_URL` if you want to override). The setup file in [apps/api/test/setup.ts](apps/api/test/setup.ts) wipes all collections between every test, so each spec starts from a clean DB.

Coverage spans:

- **Services** — finance (profile + tax estimator + outsourceable + affordability), context journal, calendar (day-range + URL helpers + event normalization + connected/disconnected states), schedule (rolling/fixed/event-driven/zone-rotation bucketing + skip_if + window clamping + pending ad-hoc), today/swap/defer/pull, zones (assessments + ad-hoc tasks), checkins, mood/energy, workouts, patterns, activity log
- **Cron** — morning-gen (rolling + fixed + zone rotation + event-driven + skip_if + ad-hoc), calendar-ingest, deferral edge cases
- **Persona wiring** — every tool declared in the persona schemas has a matching implementation in [apps/api/src/persona/tools.ts](apps/api/src/persona/tools.ts) (catches schema/impl drift; this matters even with launcher-mode personas because the API tool runtime is still maintained)
- **Auth** — session JWT round-trip + tamper-rejection + secret-rotation rejection + length-requirement enforcement; allowlist case-insensitive + comma-separated + closed-by-default; middleware accepts `API_TOKEN` *or* a valid JWT, rejects bad/missing bearers, open-passes when nothing is configured
- **Activity-log fan-out** — every action site that should log an event does (incl. `context_logged`)
- **Alexa client** — token-fallback, base-URL resolution, header construction

Test environment isolation: `NODE_ENV=test` short-circuits Google Calendar reads/writes (see [apps/api/src/utils/google-calendar.ts](apps/api/src/utils/google-calendar.ts)) so day-classification and trigger-ingest specs don't depend on the developer's actual calendar contents.

## Google sign-in (login wall on the deployed dashboard)

The dashboard renders a "Continue with Google" screen before any other UI when `VITE_GOOGLE_OAUTH_CLIENT_ID` is set at build time. The API issues a short-lived signed-JWT session after verifying the Google ID token and checking the email against `AUTH_ALLOWED_EMAIL`. Session is stored in `sessionStorage`, so closing the tab logs you out — you re-auth on every fresh visit, which is the intended demo behavior.

If those env vars aren't set, the dashboard skips the login wall entirely (useful for local dev). The middleware also still accepts the legacy `API_TOKEN` bearer so the Alexa skill / curl scripts keep working.

### One-time setup (Google Cloud Console)

You need a *separate* OAuth 2.0 Client from the one used by Google Calendar — this one is "Web application" with the dashboard origin allowlisted.

1. Google Cloud Console → APIs & Services → Credentials → **Create Credentials → OAuth client ID**.
2. Application type: **Web application**. Name it `household-os dashboard`.
3. **Authorized JavaScript origins** — add both:
   - `http://localhost:5173`
   - `https://<your-dashboard>.onrender.com`
4. **Authorized redirect URIs** — same two URLs.
5. Save. Copy the Client ID.
6. Set it as `GOOGLE_OAUTH_CLIENT_ID` on the API service and `VITE_GOOGLE_OAUTH_CLIENT_ID` on the dashboard (Render → Environment for each service). Locally, put both in their respective `.env` files.
7. Also set:
   - `AUTH_ALLOWED_EMAIL=diane@onemoregame.com` (comma-separated if you want to allow a second account)
   - `JWT_SECRET=$(openssl rand -hex 32)` — must be at least 16 chars

That's it — redeploy and the dashboard will gate on Google sign-in.

## Voice / Alexa

Setup, deployment paths, intent reference, and troubleshooting all live in [apps/alexa-skill/README.md](apps/alexa-skill/README.md). Short version: the skill is mounted on the API as `POST /alexa`. Use ngrok for dev, or skip ngrok entirely once the API is on Render.

## Deploying to Render

Render hosts the API (Express + cron + Alexa webhook). MongoDB lives separately on Atlas free tier. The dashboard can stay local — only the API needs to be public so Alexa can reach it.

**Cost:** ~$7/mo (Render Starter Web Service) + $0 (Mongo Atlas free tier). Persona chat now runs on claude.ai (no Anthropic API charges) — the in-dashboard chat windows have been replaced with launchers that hand off to per-persona Claude Projects.

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
     - `ANTHROPIC_API_KEY` — **no longer required** since persona chat happens on claude.ai. Leave blank unless you want to re-enable the in-dashboard `/api/chat/:persona` route.
     - `ALEXA_SKILL_ID`, `ALEXA_CLIENT_ID`, `ALEXA_CLIENT_SECRET` — from the Alexa Developer Console (LWA pair only needed for proactive app-card push)
   - Click **Apply**. Render builds + deploys (~3-5 minutes).

3. **Seed the production database**
   - Locally: `MONGO_URL='<your atlas string>' npm run seed` → `seeded 48 routines`.
   - Or run `npm run seed` from the Render Shell.
   - For a clean launch with nothing overdue: also run `npm -w @household-os/api run start-tomorrow` once. That backdates each rolling routine's `last_done` so first occurrences are spread naturally across each cadence cycle.

4. **Repoint Alexa**
   - Alexa Developer Console → your skill → Build → Endpoint → swap your ngrok URL for `https://<your-render-url>.onrender.com/alexa` → Save → Build Model.
   - Kill ngrok locally; you don't need it anymore.

### Updating

Push to `master` → Render auto-deploys. Logs are in the Render dashboard.

### Costs after first month

| Service            | Tier                                    | Monthly  |
| ------------------ | --------------------------------------- | -------- |
| Render Web Service | Starter (always-on)                     | $7       |
| MongoDB Atlas      | M0 (free, 512 MB)                       | $0       |
| Anthropic API      | not used — persona chat is on claude.ai | $0       |
| **Total**          |                                         | **~$7**  |

### Hosting the dashboard too

The dashboard is also defined in [render.yaml](./render.yaml) as a Static Site. Render's static-site tier is free (unlimited bandwidth, no sleep), so the total cost stays at ~$7/mo.

When you next push and re-apply the Blueprint, Render will prompt for the dashboard's env vars:

- `VITE_API_BASE` — `https://<your-render-api-url>.onrender.com/api`
- `VITE_API_TOKEN` — leave blank unless you set `API_TOKEN` on the API service

The dashboard will then be available at its own Render URL (e.g. `https://household-os-dashboard.onrender.com`).

## Project memory + docs

- [HANDOFF.md](./HANDOFF.md) — the original v1 design doc. Architectural and historical context.
- [apps/alexa-skill/README.md](apps/alexa-skill/README.md) — Alexa setup, intent reference, deployment alternatives.
- **In-app Guide** (Dashboard → ❔ Guide tab) — every voice command, every dashboard tab, every cron job, every privacy boundary. The canonical user-facing reference.
