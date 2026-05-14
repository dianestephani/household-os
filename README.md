# household-os

Diane's personal household assistant — a single-user system organized around a unified Claude assistant, a daily morning check-in, and bidirectional Google Calendar sync for the appointment-style work that actually has a time on it.

The original v1 design and the full rebuild history live in [HANDOFF.md](./HANDOFF.md). This README covers what's actually shipped after the §50 rebuild.

> **§50 rebuild status — Phases A + B + C + D shipped (A/B/C on 2026-05-11, D on 2026-05-13).** The system has been re-shaped from a six-tab "Household Ops planner" into a three-view interface (Today / Look Back / Stuff) with one unified Claude assistant in place of the three-persona launcher pattern. **Phases E-G remain.** Phase E refines Stuff (cadence-shift modal, schema simplification). **Phase F is the most-urgent remaining work — the Alexa skill currently 404s against the trimmed API.** Phase G is final polish.

For end-user docs (every dashboard tab, every cron job, every privacy boundary), open the dashboard and click the **❔ Guide** icon in the header. That's the canonical reference; this README is just for orientation + setup.

## What's in here

```text
household-os/
  packages/shared/       — types + seed inventory + unified-assistant config
  apps/api/              — Express + Mongoose + 2 crons + Alexa webhook
  apps/dashboard/        — React + Vite frontend (3 tabs + Guide icon)
  apps/alexa-skill/      — Alexa custom skill (under repair — Phase F)
  render.yaml            — Render Blueprint for one-click prod deploy
```

The skill is mounted on the API server via `ask-sdk-express-adapter`, so deploying the API also deploys the skill (`POST /alexa`). The skill's intent handlers still reference Phase-C-retired endpoints — Phase F retools them.

## Subsystems shipped (post-§50 rebuild)

| Subsystem | Where it lives |
| --- | --- |
| **Unified assistant chat** (§50 Phase A — single Claude assistant replacing the three-persona split. `POST /api/chat` runs a tool-use loop with prompt caching on system prompt + 16 wired tools; versioned system prompt in `AssistantSettings` is the live source of truth, seed lives in shared. Returns a clean offline message when `ANTHROPIC_API_KEY` isn't set, so deploys without the key still serve well-formed responses) | [packages/shared/src/persona/assistant.ts](packages/shared/src/persona/assistant.ts), [apps/api/src/persona/runner.ts](apps/api/src/persona/runner.ts), [apps/api/src/persona/assistant-tools.ts](apps/api/src/persona/assistant-tools.ts), [apps/api/src/services/assistant-settings.ts](apps/api/src/services/assistant-settings.ts), [apps/api/src/routes/chat.ts](apps/api/src/routes/chat.ts), [apps/api/src/routes/assistant-settings.ts](apps/api/src/routes/assistant-settings.ts) |
| **Morning check-in + Today view** (§50 Phase B — one `MorningCheckin` doc per local day captures mood + energy + awakeness + optional note. The Today view is a single column: check-in form (collapses to a summary line once saved) → Calendar today strip → static Habits reminder pills → AskPanel chat with the unified assistant. No streaks, no scoring) | [apps/api/src/db/models/MorningCheckin.ts](apps/api/src/db/models/MorningCheckin.ts), [apps/api/src/services/morning-checkin.ts](apps/api/src/services/morning-checkin.ts), [apps/api/src/routes/morning-checkin.ts](apps/api/src/routes/morning-checkin.ts), [apps/dashboard/src/components/TodayView.tsx](apps/dashboard/src/components/TodayView.tsx), [apps/dashboard/src/components/MorningCheckinForm.tsx](apps/dashboard/src/components/MorningCheckinForm.tsx), [apps/dashboard/src/components/HabitsReminder.tsx](apps/dashboard/src/components/HabitsReminder.tsx), [apps/dashboard/src/components/AskPanel.tsx](apps/dashboard/src/components/AskPanel.tsx) |
| **Three-view dashboard** (§50 Phase C — Today landing + Look Back retrospective + Stuff CRUD with sub-tabs Routines/Finance/Assistant Settings. Single `❔ Guide` header icon. Tab persistence + legacy-localStorage migration in `App.tsx`) | [apps/dashboard/src/App.tsx](apps/dashboard/src/App.tsx), [apps/dashboard/src/components/LookBackPanel.tsx](apps/dashboard/src/components/LookBackPanel.tsx), [apps/dashboard/src/components/StuffPanel.tsx](apps/dashboard/src/components/StuffPanel.tsx), [apps/dashboard/src/components/AssistantSettingsPanel.tsx](apps/dashboard/src/components/AssistantSettingsPanel.tsx) |
| **Look Back retrospective** (§50 Phase D — three read-only sections: This week (workout count vs 3/week target + 7-day check-in strip), This month (gross−tax−fixed−discretionary=Net rollup + latest RocketMoney import's top 5 categories), Patterns (auto-hides when nothing notable; backed by an on-demand pattern surfacer with two detectors — workout skips by awakeness, consecutive low-mood days)) | [apps/api/src/services/patterns-simple.ts](apps/api/src/services/patterns-simple.ts), [apps/api/src/routes/look-back.ts](apps/api/src/routes/look-back.ts), [apps/dashboard/src/components/LookBackPanel.tsx](apps/dashboard/src/components/LookBackPanel.tsx) |
| **Calendar (today's events)** (passthrough to Google Calendar with normalized event shape, click-through to event + day permalinks; plus an `upcomingEvents(days)` helper for the assistant's `get_calendar_range` tool) | [apps/api/src/services/calendar.ts](apps/api/src/services/calendar.ts), [apps/api/src/routes/calendar.ts](apps/api/src/routes/calendar.ts), [apps/dashboard/src/components/CalendarDayPanel.tsx](apps/dashboard/src/components/CalendarDayPanel.tsx) |
| **Calendar trigger ingestion** (Airbnb, dogsit, landscaper, cleaner — 5:30 AM cron pulls 7 days ahead from Google Calendar) | [apps/api/src/cron/calendar-ingest.ts](apps/api/src/cron/calendar-ingest.ts) |
| **Per-appointment Calendar events** (appointment-enabled routines like haircut / head spa / oil change get their own Google Calendar event; hourly cron reconciles reschedules + cancellations + past-completions back into routine state — Calendar wins) | [apps/api/src/services/appointments.ts](apps/api/src/services/appointments.ts), [apps/api/src/cron/appointment-reconcile.ts](apps/api/src/cron/appointment-reconcile.ts), [apps/api/src/routes/appointments.ts](apps/api/src/routes/appointments.ts), [apps/dashboard/src/components/RoutinesPage.tsx](apps/dashboard/src/components/RoutinesPage.tsx) |
| **Workouts module** (retroactive log only after §50 Phase C — no scheduled-slot enforcement, no night-before commit. Diane logs status/notes after the fact; Look Back surfaces the weekly count) | [apps/api/src/services/workouts.ts](apps/api/src/services/workouts.ts), [apps/api/src/routes/workouts.ts](apps/api/src/routes/workouts.ts) |
| **Activity log** (kept as invisible infrastructure — 10 surviving event kinds: morning_checkin_logged, workout_logged, trigger_added, routine_edited, finance_import_added, finance_snapshot_restored, appointment_created, appointment_rescheduled, appointment_deleted_externally, task_done) | [apps/api/src/services/activity.ts](apps/api/src/services/activity.ts) |
| **Finance module** (gross-income profile, 2025 federal/FICA/state tax estimator, outsourceable monthly cost rollup, greedy-fit affordability report) | [apps/api/src/services/finance.ts](apps/api/src/services/finance.ts), [apps/api/src/routes/finance.ts](apps/api/src/routes/finance.ts), [apps/dashboard/src/components/FinancePanel.tsx](apps/dashboard/src/components/FinancePanel.tsx) |
| **RocketMoney imports + profile history** (paste-or-CSV ingestion with server-side CSV parser, every save writes a `FinancialProfileSnapshot` so the profile is append-only history; apply-an-import flow rewrites the assistant-facing `expense_breakdown` and tags the snapshot with provenance; restore from any snapshot, which itself writes a new `restore` snapshot) | [apps/api/src/services/csv-parser.ts](apps/api/src/services/csv-parser.ts), [apps/api/src/services/finance-history.ts](apps/api/src/services/finance-history.ts) |
| **Routines CRUD** (Mongoose `Routine` model + `patchRoutine` allow-list; surfaced in the Stuff → Routines table) | [apps/api/src/db/models/Routine.ts](apps/api/src/db/models/Routine.ts), [apps/api/src/services/routines.ts](apps/api/src/services/routines.ts), [apps/dashboard/src/components/RoutinesPage.tsx](apps/dashboard/src/components/RoutinesPage.tsx) |
| **Alexa Shopping List integration** (paste a grocery list, parse `## section` headers + bullet rows, bulk-add to your default Alexa list. **Read-only — never touches Amazon cart, never places orders.** Requires one-time LWA permission grant in the Alexa app. Currently has no dashboard UI after Phase C — the assistant can drive it via tools in Phase E) | [apps/api/src/services/alexa-shopping-list.ts](apps/api/src/services/alexa-shopping-list.ts), [apps/api/src/services/grocery-list-parser.ts](apps/api/src/services/grocery-list-parser.ts), [apps/api/src/services/alexa-lwa.ts](apps/api/src/services/alexa-lwa.ts) |
| **Theme + typography** (light/dark toggle persisted in localStorage with prefers-color-scheme fallback, Inter body + Fraunces display from Google Fonts, strict-grayscale palette + muted semantic colors) | [apps/dashboard/src/styles.css](apps/dashboard/src/styles.css), [apps/dashboard/src/components/ThemeToggle.tsx](apps/dashboard/src/components/ThemeToggle.tsx), [apps/dashboard/index.html](apps/dashboard/index.html) |
| **Google sign-in wall** (Google Identity Services button, email allowlist, signed-JWT session in localStorage with 30-day expiry; API middleware accepts either the legacy `API_TOKEN` *or* a valid session JWT) | [apps/dashboard/src/components/LoginScreen.tsx](apps/dashboard/src/components/LoginScreen.tsx), [apps/dashboard/src/auth.ts](apps/dashboard/src/auth.ts), [apps/api/src/services/session.ts](apps/api/src/services/session.ts), [apps/api/src/middleware/auth.ts](apps/api/src/middleware/auth.ts), [apps/api/src/routes/auth.ts](apps/api/src/routes/auth.ts) |
| **Alexa skill** (intent handlers still reference retired endpoints — Phase F retools `WhatsLeftIntent` against the Calendar instead of the deleted `TodayPlan`, drops the rest. The webhook stays mounted at `POST /alexa` and the morning proactive push still fires) | [apps/alexa-skill/](apps/alexa-skill/) |

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
#  (Phase C deleted the per-persona launcher pattern — chat goes through
#  the unified `/api/chat` endpoint exclusively now.)
#  GOOGLE_CALENDAR_* envs only needed if you want calendar/trigger ingestion.
#  GOOGLE_OAUTH_CLIENT_ID + AUTH_ALLOWED_EMAIL + JWT_SECRET only needed if you
#  want the Google login wall — leave blank locally to skip auth entirely.)

# 3. local mongo
brew services start mongodb-community

# 4. seed the ~49 routines from inventory.json
npm run seed

# 5. (one-time) backdate every rolling routine so nothing is overdue and
#    the first occurrences are spread naturally across each cadence cycle
npm -w @household-os/api run start-tomorrow

# 6. API + dashboard in two shells
npm run dev:api          # :3000
npm run dev:dashboard    # :5173 (proxies /api → :3000)
```

Open <http://localhost:5173>. **Today** is the landing page (morning check-in + calendar strip + habits + Ask). **Look Back** is the retrospective surface. **Stuff** holds Routines / Finance / Assistant Settings. The **❔ Guide** icon in the header has the full how-to.

## Tests

```bash
npm test                 # all workspaces — currently 213 tests (203 API + 10 alexa-skill)
npm run typecheck        # all workspaces
```

API tests use a separate `household_os_test` database on local Mongo (set via `MONGO_TEST_URL` if you want to override). The setup file in [apps/api/test/setup.ts](apps/api/test/setup.ts) wipes all collections between every test, so each spec starts from a clean DB.

Coverage spans (post-§50 Phase C):

- **Unified assistant** (§50 Phase A) — assistant-settings auto-seed + version-push + reset + empty-prompt rejection; assistant-tools drift detector + deferred-tool exclusion + create/delete-routine validation + `get_morning_checkin` / `recent_checkins` happy + null paths + tax-estimator math; runner offline path + tool-use loop + unknown-tool `is_error` recovery + round-cap bailout
- **Morning check-in** (§50 Phase B) — `upsertCheckin` idempotency (single doc per date) + invalid-enum rejection + 500-char note cap + create-vs-update activity-log flag + date defaults + explicit-date backfill; `recentCheckins` window + clamp; `getCheckin` null/default/malformed paths
- **Look Back patterns** (§50 Phase D) — `skippedWorkoutsByAwakeness` thresholds (≥2 skips, ≥75% dominance) + all-vs-majority phrasing + same-day-checkin denominator filter + done/partial exclusion + window respect; `consecutiveLowMood` 3-day-run gate + gap tolerance + null-on-empty; `detectPatterns` orchestrator window clamp + multi-pattern emission
- **Finance** — profile CRUD + singleton math, tax estimator (WA / extra-withholding / CA / unknown-state / zero-income), outsourceable cadence math, affordability greedy split + zero-discretionary rationale
- **Finance history** — `saveSnapshot` + `restoreSnapshot` round-trip, snapshot-on-PATCH wiring, `addImport` validation + activity log, `applyImportToProfile` for both paste + CSV with provenance tagging, restore chains
- **CSV parser** — required-column detection, quoted fields with embedded commas, negative-amount formats, outflow-only filter, malformed-row handling, `parseImportDate` round-trip guard
- **Appointments** (§47 Phase 4) — pure `diffAppointment` decision table (no_change / rescheduled / deleted / past_completed precedence), I/O wrappers (createAppointment defaults / 4 reject paths, reconcile skip-paths, clearAppointmentLink)
- **Calendar** — `dayRange` math, URL zero-padding, event normalization (timed / all-day / missing-required → null), disconnected-state behavior
- **Cron** — calendar-ingest trigger upsert + dedupe; appointment-reconcile is exercised via the service layer
- **Routines CRUD** — `patchRoutine` allow-list silently drops disallowed fields (`key`, `_id`, anything off the curated list); list filters by category + zone; soft delete flips `active` without removing the doc
- **Workouts** — retroactive log validation + history
- **Auth** — session JWT round-trip + tamper-rejection + secret-rotation rejection + length-requirement enforcement; allowlist case-insensitive + comma-separated + closed-by-default; middleware accepts `API_TOKEN` *or* a valid JWT
- **Alexa shopping list** — grocery-list-parser (`## section` + bullet rows + fence stripping); shopping-list service no-token gating
- **Alexa client** — token-fallback, base-URL resolution, header construction (10 alexa-skill tests)

Test environment isolation: `NODE_ENV=test` short-circuits Google Calendar + LWA reads/writes (see [apps/api/src/utils/google-calendar.ts](apps/api/src/utils/google-calendar.ts), [apps/api/src/services/alexa-lwa.ts](apps/api/src/services/alexa-lwa.ts)) so tests don't depend on the developer's actual calendar contents or LWA token.

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

## Chat with the assistant

Chat happens through the dashboard's **Today → Ask** panel, which round-trips against `POST /api/chat`. The unified assistant has 16 tools wired (calendar reads, routines CRUD, finance reads, retroactive workout logging, RocketMoney imports, morning check-in reads — see [packages/shared/src/persona/assistant.ts](packages/shared/src/persona/assistant.ts) for the full list).

The MCP server + Claude.ai Custom Connector path retired in §50 Phase C. If you want to bring it back, restore `apps/api/src/mcp/` from git — but the dashboard's AskPanel covers the same surface with less operational complexity.

To edit the system prompt the assistant uses, go to **Stuff → Assistant settings** and edit the live prompt; every save pushes a new version and rollback is one click.

## Voice / Alexa

Setup, deployment paths, intent reference, and troubleshooting all live in [apps/alexa-skill/README.md](apps/alexa-skill/README.md). Short version: the skill is mounted on the API as `POST /alexa`. Use ngrok for dev, or skip ngrok entirely once the API is on Render.

## Deploying to Render

Render hosts the API (Express + cron + Alexa webhook). MongoDB lives separately on Atlas free tier. The dashboard can stay local — only the API needs to be public so Alexa can reach it.

**Cost:** ~$7/mo (Render Starter Web Service) + $0 (Mongo Atlas free tier) + $5-15/mo Anthropic API (the unified `/api/chat` endpoint — prompt caching keeps the input cost low). If you skip the Anthropic key, the dashboard's AskPanel renders the offline message verbatim and the rest of the surface (morning check-in, calendar strip, Stuff/Finance, Stuff/Routines, Stuff/Assistant Settings) still works.

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
