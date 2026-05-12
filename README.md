# household-os

Diane's "Household Ops" assistant — a single-user system that knows her recurring routines, generates a daily plan sized to her available energy, and surfaces it via dashboard, Alexa, and Google Calendar.

The original v1 design lives in [HANDOFF.md](./HANDOFF.md). This README covers what's actually shipped — including everything we've built since the v1 scaffold.

> **Rebuild in progress** — HANDOFF §50 documents a re-simplification of this system to a "three-view" shape (Today / Look Back / Stuff) with a single unified Claude assistant in place of the three-persona launcher pattern. **Phase A (assistant scaffolding) shipped 2026-05-11 — HANDOFF §51. Phase B (MorningCheckin model + new Today view) shipped 2026-05-11 — HANDOFF §52.** Phases C-G follow. The old persona launchers still work through the transition.

For end-user docs (every voice command, every dashboard tab, every cron job, every privacy boundary), open the dashboard and click the **❔ Guide** tab in the top-right of the nav. That's the canonical reference; this README is just for orientation + setup.

## What's in here

```text
household-os/
  packages/shared/       — types + seed inventory + persona configs
  apps/api/              — Express + Mongoose + cron + publisher + MCP + Alexa webhook
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
| **Date-aware Workouts / Activity / Journal / Finance** (shared `DayNavigator` reused across tabs: workouts shows logged-or-scheduled per date with logging only enabled on today; activity + journal have Range/Single-day mode toggle so you can ask "what did I do on April 30"; finance has a per-day log section that surfaces finance-tagged context entries + profile/outsource-cost edits while the profile + breakdown stay as current-state) | [apps/dashboard/src/components/DayNavigator.tsx](apps/dashboard/src/components/DayNavigator.tsx), [apps/dashboard/src/components/WorkoutPanel.tsx](apps/dashboard/src/components/WorkoutPanel.tsx), [apps/dashboard/src/components/ActivityFeed.tsx](apps/dashboard/src/components/ActivityFeed.tsx), [apps/dashboard/src/components/JournalPanel.tsx](apps/dashboard/src/components/JournalPanel.tsx), [apps/dashboard/src/components/FinancePanel.tsx](apps/dashboard/src/components/FinancePanel.tsx) |
| **Tab persistence + page-reload preserves view** (active dashboard tab is mirrored to localStorage, so the mobile refresh button no longer dumps you back to Today) | [apps/dashboard/src/App.tsx](apps/dashboard/src/App.tsx) |
| **Google Tasks integration** (read + mark-done from the dashboard — Tasks API across all task lists, date-filtered onto the day navigator, checkbox mutations write back to Google) | [apps/api/src/utils/google-tasks.ts](apps/api/src/utils/google-tasks.ts), [apps/api/src/services/tasks.ts](apps/api/src/services/tasks.ts), [apps/api/src/routes/tasks.ts](apps/api/src/routes/tasks.ts) |
| **Ad-hoc task creation** (free-form task add — direct creation without a zone assessment, slots into morning-gen's severity + age priority just like assessment-generated tasks; reachable from Alexa, the persona tools, MCP, or `POST /api/zones/tasks`) | [apps/api/src/services/zones.ts](apps/api/src/services/zones.ts) (`createAdHocTask`), [apps/api/src/routes/zones.ts](apps/api/src/routes/zones.ts) |
| **MCP server** (Model Context Protocol — exposes a focused subset of household tools to Claude.ai's Custom Connectors at `/mcp` via Streamable HTTP. `add_ad_hoc_task`, `mark_done`, `log_context`, `log_mood`, `update_energy`, `log_workout`, `swap_task` + read tools to ground responses. Auth via `?token=` query param.) | [apps/api/src/mcp/server.ts](apps/api/src/mcp/server.ts), [apps/api/src/mcp/route.ts](apps/api/src/mcp/route.ts) |
| **Calendar (today's events)** (passthrough to Google Calendar with normalized event shape, click-through to event + day permalinks) | [apps/api/src/services/calendar.ts](apps/api/src/services/calendar.ts), [apps/api/src/routes/calendar.ts](apps/api/src/routes/calendar.ts), [apps/dashboard/src/components/CalendarDayPanel.tsx](apps/dashboard/src/components/CalendarDayPanel.tsx) |
| **Calendar trigger ingestion** (Airbnb, dogsit, landscaper, cleaner) | [apps/api/src/cron/calendar-ingest.ts](apps/api/src/cron/calendar-ingest.ts) |
| **Per-appointment Calendar events** (appointment-enabled routines like haircut/head spa/oil change get their own Google Calendar event; hourly cron reconciles reschedules + cancellations + past-completions back into routine state — Calendar wins) | [apps/api/src/services/appointments.ts](apps/api/src/services/appointments.ts), [apps/api/src/cron/appointment-reconcile.ts](apps/api/src/cron/appointment-reconcile.ts), [apps/api/src/routes/appointments.ts](apps/api/src/routes/appointments.ts), [apps/dashboard/src/components/RoutinesPage.tsx](apps/dashboard/src/components/RoutinesPage.tsx) |
| **Publisher** (debounced fan-out to Google Calendar + Alexa app cards) | [apps/api/src/publisher/](apps/api/src/publisher/) |
| **Mood + energy logging** | [apps/api/src/services/mood.ts](apps/api/src/services/mood.ts), [apps/api/src/services/energy.ts](apps/api/src/services/energy.ts) |
| **Workouts module** (today's slot, log status, history) | [apps/api/src/services/workouts.ts](apps/api/src/services/workouts.ts) |
| **Zone assessments → ad-hoc tasks** (rotates 1 zone per day, severity + age priority) | [apps/api/src/services/zones.ts](apps/api/src/services/zones.ts) |
| **Check-in system** (morning intent / evening retro / weekly review / pattern interrupts / zone assessments) | [apps/api/src/services/checkins.ts](apps/api/src/services/checkins.ts), [apps/api/src/services/checkin-generators.ts](apps/api/src/services/checkin-generators.ts) |
| **Pattern detection** (frequent deferrals, missed workout streaks) | [apps/api/src/services/patterns.ts](apps/api/src/services/patterns.ts) |
| **Persistent activity log** (unified timeline, all events incl. `context_logged`) | [apps/api/src/services/activity.ts](apps/api/src/services/activity.ts) |
| **Finance module** (gross-income profile, 2025 federal/FICA/state tax estimator, outsourceable monthly cost rollup, greedy-fit affordability report) | [apps/api/src/services/finance.ts](apps/api/src/services/finance.ts), [apps/api/src/routes/finance.ts](apps/api/src/routes/finance.ts), [apps/dashboard/src/components/FinancePanel.tsx](apps/dashboard/src/components/FinancePanel.tsx) |
| **RocketMoney imports + profile history** (paste-or-CSV ingestion with server-side CSV parser, every save writes a `FinancialProfileSnapshot` so the profile is append-only history; apply-an-import flow rewrites the persona-facing `expense_breakdown` and tags the snapshot with provenance; restore from any snapshot, which itself writes a new `restore` snapshot) | [apps/api/src/services/csv-parser.ts](apps/api/src/services/csv-parser.ts), [apps/api/src/services/finance-history.ts](apps/api/src/services/finance-history.ts) |
| **Context journal** (shared narrative log for both personas; free-form text + structured `dogsit_count` / `energy` / `mood` / `blocked_activities` / `tags` / `related_persona`) | [apps/api/src/services/context.ts](apps/api/src/services/context.ts), [apps/api/src/routes/context.ts](apps/api/src/routes/context.ts), [apps/dashboard/src/components/JournalPanel.tsx](apps/dashboard/src/components/JournalPanel.tsx) |
| **Persona launchers** (Household Ops + Finance + Grocery Manager — each persona's `config.projectUrl` is hardcoded to its canonical Claude.ai Project. Opens in claude.ai with no Anthropic API key required; on iOS, tapping the link prompts to open in the Claude app via Universal Links if installed. The full system prompt is rendered alongside with a Copy button for re-pasting into the Project settings.) | [apps/dashboard/src/components/PersonaLauncher.tsx](apps/dashboard/src/components/PersonaLauncher.tsx), [packages/shared/src/personas/](packages/shared/src/personas/) |
| **Meal Week Calendar** (interactive 7-day meal calendar on the Food tab — day-pill strip + recipe panel with ingredients/steps/notes; week navigator ±7 days; paste-JSON admin that ingests Grocery Manager's `MEAL WEEK JSON` block from claude.ai; scoped warm cream/terracotta palette distinct from the rest of the dashboard) | [apps/api/src/services/meal-weeks.ts](apps/api/src/services/meal-weeks.ts), [apps/api/src/routes/meal-weeks.ts](apps/api/src/routes/meal-weeks.ts), [apps/dashboard/src/components/MealWeekCalendar.tsx](apps/dashboard/src/components/MealWeekCalendar.tsx), [packages/shared/src/sample-meal-week.json](packages/shared/src/sample-meal-week.json) |
| **Persona tool definitions** (Household Ops + Finance tool schemas + runtime implementations — consumed by the MCP server. No in-API chat loop; chat happens on claude.ai or via MCP.) | [apps/api/src/persona/tools.ts](apps/api/src/persona/tools.ts), [packages/shared/src/personas/](packages/shared/src/personas/) |
| **Unified assistant chat** (§50 Phase A — single Claude assistant replacing the three-persona split. `POST /api/chat` runs a tool-use loop with prompt caching on system prompt + 16 wired tools; versioned system prompt in `AssistantSettings` is the live source of truth, seed lives in shared. Returns a clean offline message when `ANTHROPIC_API_KEY` isn't set, so deploys without the key still serve well-formed responses. Phase B adds the AskPanel UI; Phase E adds remaining tools) | [packages/shared/src/persona/assistant.ts](packages/shared/src/persona/assistant.ts), [apps/api/src/persona/runner.ts](apps/api/src/persona/runner.ts), [apps/api/src/persona/assistant-tools.ts](apps/api/src/persona/assistant-tools.ts), [apps/api/src/services/assistant-settings.ts](apps/api/src/services/assistant-settings.ts), [apps/api/src/routes/chat.ts](apps/api/src/routes/chat.ts), [apps/api/src/routes/assistant-settings.ts](apps/api/src/routes/assistant-settings.ts) |
| **Morning check-in + new Today view** (§50 Phase B — one `MorningCheckin` doc per local day captures mood + energy + awakeness + optional note in one go; replaces the old MoodLog/EnergyLog/morning-intent split. The dashboard's `Today` tab is now a single column: check-in form (collapses to a summary line once saved) → Calendar today strip → static Habits reminder pills → `AskPanel` chat with the unified assistant. No streaks, no scoring — pure introspection per §50) | [apps/api/src/db/models/MorningCheckin.ts](apps/api/src/db/models/MorningCheckin.ts), [apps/api/src/services/morning-checkin.ts](apps/api/src/services/morning-checkin.ts), [apps/api/src/routes/morning-checkin.ts](apps/api/src/routes/morning-checkin.ts), [apps/dashboard/src/components/TodayView.tsx](apps/dashboard/src/components/TodayView.tsx), [apps/dashboard/src/components/MorningCheckinForm.tsx](apps/dashboard/src/components/MorningCheckinForm.tsx), [apps/dashboard/src/components/HabitsReminder.tsx](apps/dashboard/src/components/HabitsReminder.tsx), [apps/dashboard/src/components/AskPanel.tsx](apps/dashboard/src/components/AskPanel.tsx) |
| **Alexa skill** (16 voice intents including WhatsLeftIntent + multi-turn morning check-in + proactive app cards) | [apps/alexa-skill/](apps/alexa-skill/) |
| **Alexa Shopping List integration** (Food tab "Send to Alexa Shopping List" — paste Grocery Manager's list, parse `## section` headers + bullet rows, bulk-add to your default Alexa list. **Read-only — never touches Amazon cart, never places orders.** Requires one-time LWA permission grant in the Alexa app) | [apps/api/src/services/alexa-shopping-list.ts](apps/api/src/services/alexa-shopping-list.ts), [apps/api/src/services/grocery-list-parser.ts](apps/api/src/services/grocery-list-parser.ts), [apps/dashboard/src/components/ShoppingListPanel.tsx](apps/dashboard/src/components/ShoppingListPanel.tsx) |
| **Alexa Reminders for appointments** (hourly cron creates an Alexa Reminder 30 min before each scheduled appointment, idempotent per calendar event; requires same LWA permission grant) | [apps/api/src/services/alexa-reminders.ts](apps/api/src/services/alexa-reminders.ts), [apps/api/src/cron/appointment-reconcile.ts](apps/api/src/cron/appointment-reconcile.ts) |
| **Theme + typography** (light/dark toggle persisted in localStorage with prefers-color-scheme fallback, Inter body + Fraunces display from Google Fonts, strict-grayscale palette + muted semantic colors) | [apps/dashboard/src/styles.css](apps/dashboard/src/styles.css), [apps/dashboard/src/components/ThemeToggle.tsx](apps/dashboard/src/components/ThemeToggle.tsx), [apps/dashboard/index.html](apps/dashboard/index.html) |
| **Google sign-in wall** (Google Identity Services button on the dashboard, email allowlist, short-lived signed-JWT session in `sessionStorage` so the user re-auths on every fresh tab; API middleware accepts either the legacy `API_TOKEN` *or* a valid session JWT) | [apps/dashboard/src/components/LoginScreen.tsx](apps/dashboard/src/components/LoginScreen.tsx), [apps/dashboard/src/auth.ts](apps/dashboard/src/auth.ts), [apps/api/src/services/session.ts](apps/api/src/services/session.ts), [apps/api/src/middleware/auth.ts](apps/api/src/middleware/auth.ts), [apps/api/src/routes/auth.ts](apps/api/src/routes/auth.ts) |
| **Dashboard** (6 tabs — Home widget grid as default landing surface, Today drill-down, Schedule, Workouts, Finance, Log; + 4 header icons — Household Ops 💬, Food 🛒, Routines ⚙️, Guide ❔) | [apps/dashboard/](apps/dashboard/) |
| **Home widget grid** (7 independently-loading cards: Today summary, Calendar today, Workouts week, Finance discretionary, Recent activity ticker w/ relative timestamps, today's Journal w/ inline quick-add, rotating Zone-check chip) | [apps/dashboard/src/components/HomePanel.tsx](apps/dashboard/src/components/HomePanel.tsx), [apps/dashboard/src/utils/relativeTime.ts](apps/dashboard/src/utils/relativeTime.ts) |

## Quick start (local)

```bash
# 1. install
npm install

# 2. environment
cp .env.example .env
cp apps/dashboard/.env.example apps/dashboard/.env
# (edit .env — at minimum: MONGO_URL. API_TOKEN can be empty for local dev.
#  ANTHROPIC_API_KEY enables `POST /api/chat` (§50 Phase A); leave blank and
#  the route returns a `{live: false}` offline message. The launcher-mode
#  per-persona chat (Claude.ai Projects) still works without a key.
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

Open <http://localhost:5173>. The Home tab (widget grid) is the landing page; Today is the drill-down for actively managing today's plan. The **❔ Guide** icon in the header has the full how-to.

## Tests

```bash
npm test                 # all workspaces — currently 394 tests (384 API + 10 alexa-skill)
npm run typecheck        # all workspaces
```

API tests use a separate `household_os_test` database on local Mongo (set via `MONGO_TEST_URL` if you want to override). The setup file in [apps/api/test/setup.ts](apps/api/test/setup.ts) wipes all collections between every test, so each spec starts from a clean DB.

Coverage spans:

- **Services** — finance (profile + tax estimator + outsourceable + affordability), context journal, calendar (day-range + URL helpers + event normalization + connected/disconnected states), schedule (rolling/fixed/event-driven/zone-rotation bucketing + skip_if + window clamping + pending ad-hoc), today/swap/defer/pull, zones (assessments + ad-hoc tasks), checkins, mood/energy, workouts, patterns, activity log
- **Cron** — morning-gen (rolling + fixed + zone rotation + event-driven + skip_if + ad-hoc), calendar-ingest, deferral edge cases
- **Persona wiring** — every tool declared in the persona schemas has a matching implementation in [apps/api/src/persona/tools.ts](apps/api/src/persona/tools.ts) (catches schema/impl drift; this matters even with launcher-mode personas because the API tool runtime is still maintained)
- **Unified assistant** (§50 Phase A) — assistant-settings auto-seed + version-push + reset + empty-prompt rejection; assistant-tools drift detector + deferred-tool exclusion + create/delete-routine validation + tax-estimator math; runner offline path + tool-use loop + unknown-tool `is_error` recovery + round-cap bailout
- **Morning check-in** (§50 Phase B) — `upsertCheckin` idempotency (single doc per date) + invalid-enum rejection + 500-char note cap + create-vs-update activity-log flag + date defaults + explicit-date backfill; `recentCheckins` window + clamp; `getCheckin` null/default/malformed paths; assistant tool wiring for `get_morning_checkin` + `recent_checkins`
- **Auth** — session JWT round-trip + tamper-rejection + secret-rotation rejection + length-requirement enforcement; allowlist case-insensitive + comma-separated + closed-by-default; middleware accepts `API_TOKEN` *or* a valid JWT, rejects bad/missing bearers, open-passes when nothing is configured
- **Routines CRUD** — `patchRoutine` allow-list silently drops disallowed fields (`key`, `_id`, anything off the curated list); list filters by category + zone; soft delete flips `active` without removing the doc
- **Zone-assessment multi-task split** — `splitTaskNotes` (empty/null/whitespace → []; commas split; segments trimmed; empty segments dropped; only commas separate — semicolons / slashes / newlines stay inside a segment) and `recordAssessment` (one task per comma-separated item, single-item notes still produce 1 task, fallback to default name when all segments are empty, one activity log entry per task, all tasks linked to same source assessment)
- **Alexa proactive cards** — `buildCheckInCardBody` template logic: morning_intent message, frequent-deferral with routine name + count, missed-workouts copy, fallback for unknown kinds, null for check-in types we deliberately don't push
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
   - `AUTH_ALLOWED_EMAIL=diane.stephani@gmail.com` (the personal Gmail Diane uses for the Google OAuth flow — *not* the OMG work email. Comma-separated if you want to allow a second account.)
   - `JWT_SECRET=$(openssl rand -hex 32)` — must be at least 16 chars

That's it — redeploy and the dashboard will gate on Google sign-in.

## Claude.ai → household-os (MCP Custom Connector)

The API exposes a Model Context Protocol server at `/mcp`. Add it as a Custom Connector on Claude.ai (Pro/Team) and your Household Ops persona on Claude.ai gets real tools: `add_ad_hoc_task`, `mark_done`, `swap_task`, `log_context`, `log_mood`, `update_energy`, `log_workout` + read tools (`get_today`, `recent_activity`, `recent_context`, `list_open_zone_tasks`).

**One-time setup:**

1. In Claude.ai, *Settings → Connectors → Add Custom Connector*.
2. URL: `https://<your-render-api>.onrender.com/mcp?token=<your-API_TOKEN>` (the token is the same `API_TOKEN` env var the Alexa skill uses — easiest to include as a query param since Claude.ai's connector UI doesn't have a header-injection field).
3. Name it "Household OS" or similar. Save.
4. In your Household Ops Claude Project (the one you wired through the Persona Launcher), enable the connector for that Project.

After that, the persona can call tools directly while you're chatting on claude.ai — "I cleaned the bathrooms today" → it calls `mark_done` if the routine is on today's plan, or `add_ad_hoc_task` if you're flagging something not currently scheduled. Per the persona's system prompt it'll ask one clarifying question before guessing (zone? severity?).

## Voice / Alexa

Setup, deployment paths, intent reference, and troubleshooting all live in [apps/alexa-skill/README.md](apps/alexa-skill/README.md). Short version: the skill is mounted on the API as `POST /alexa`. Use ngrok for dev, or skip ngrok entirely once the API is on Render.

## Deploying to Render

Render hosts the API (Express + cron + Alexa webhook). MongoDB lives separately on Atlas free tier. The dashboard can stay local — only the API needs to be public so Alexa can reach it.

**Cost:** ~$7/mo (Render Starter Web Service) + $0 (Mongo Atlas free tier) + $5-15/mo Anthropic API (only if you enable §50 Phase A's `/api/chat` — prompt caching keeps the input cost low). Per-persona launchers still hand off to claude.ai for $0 if you'd rather not pay for the API.

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

| Service            | Tier                                         | Monthly    |
| ------------------ | -------------------------------------------- | ---------- |
| Render Web Service | Starter (always-on)                          | $7         |
| MongoDB Atlas      | M0 (free, 512 MB)                            | $0         |
| Anthropic API      | optional — unified `/api/chat` (§50 Phase A) | $0-15      |
| **Total**          |                                              | **~$7-22** |

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
