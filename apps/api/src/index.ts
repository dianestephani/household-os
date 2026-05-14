import 'dotenv/config';
import express from 'express';
import cron from 'node-cron';
import { ExpressAdapter } from 'ask-sdk-express-adapter';
import { skill as alexaSkill } from '@household-os/alexa-skill';
import { connect } from './db/connection.js';
import routinesRouter from './routes/routines.js';
import triggersRouter from './routes/triggers.js';
import workoutsRouter from './routes/workouts.js';
import financeRouter from './routes/finance.js';
import calendarRouter from './routes/calendar.js';
import appointmentsRouter from './routes/appointments.js';
import alexaRouter from './routes/alexa.js';
import authRouter from './routes/auth.js';
import chatRouter from './routes/chat.js';
import assistantSettingsRouter from './routes/assistant-settings.js';
import morningCheckinRouter from './routes/morning-checkin.js';
import lookBackRouter from './routes/look-back.js';
import { requireToken } from './middleware/auth.js';
import { ingestCalendarTriggers } from './cron/calendar-ingest.js';
import { reconcileAppointmentsCron } from './cron/appointment-reconcile.js';

/**
 * §50 Phase C — compressed API surface. Retired (with code deleted):
 *
 *   - `/api/today/*`, `/api/zones/*`, `/api/checkins/*`, `/api/patterns/*`,
 *     `/api/mood`, `/api/energy`, `/api/context`, `/api/day/:date`,
 *     `/api/schedule`, `/api/meal-weeks/*`, `/api/tasks/*`, `/api/activity`
 *   - `/mcp` Custom Connector + the underlying MCP server
 *   - `morning-gen` cron + the evening retro / morning intent / weekly review
 *     / pattern interrupt / zone assessment check-in generators
 *   - The Publisher debounced fan-out (was specific to TodayPlan writes)
 *
 * What stays: the surviving routes wired below, plus the two crons (Calendar
 * trigger ingest + per-appointment reconcile from §47 Phase 4).
 */

const url = process.env.MONGO_URL ?? 'mongodb://localhost:27017/household_os';
await connect(url);
console.log(`[api] connected to mongo at ${url}`);

const app = express();

app.use((req, res, next) => {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', 'authorization, content-type');
  res.setHeader('access-control-allow-methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

/**
 * Alexa custom-skill webhook. Mounted BEFORE express.json() because the SDK
 * needs the raw body to verify Amazon's request signature. Verification is on
 * by default; flip ALEXA_SKIP_VERIFY=1 only for local mock tests (never prod).
 *
 * Phase F will retool the skill's intents — the webhook stays mounted through
 * Phase C so the morning push + WhatsLeftIntent keep working in the interim.
 */
const verifySignature = process.env.ALEXA_SKIP_VERIFY !== '1';
const alexaAdapter = new ExpressAdapter(alexaSkill, verifySignature, verifySignature);
app.post('/alexa', alexaAdapter.getRequestHandlers());

app.use(express.json({ limit: '1mb' }));

// Login endpoint must NOT require auth (chicken-and-egg). Mount before the
// `/api` requireToken guard below.
app.use('/api/auth', authRouter);

app.get('/', (_req, res) => {
  res.json({
    service: 'household-os-api',
    status: 'ok',
    docs: 'https://github.com/dianestephani/household-os',
    endpoints: {
      health: '/health',
      alexa_webhook: '/alexa',
      api: [
        '/api/auth/google',
        '/api/routines',
        '/api/triggers',
        '/api/workouts',
        '/api/finance',
        '/api/calendar/today',
        '/api/appointments',
        '/api/alexa',
        '/api/chat',
        '/api/assistant-settings',
        '/api/morning-checkin',
        '/api/look-back/patterns',
      ],
    },
  });
});

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.use('/api', requireToken);
app.use('/api/routines', routinesRouter);
app.use('/api/triggers', triggersRouter);
app.use('/api/workouts', workoutsRouter);
app.use('/api/finance', financeRouter);
app.use('/api/calendar', calendarRouter);
app.use('/api/appointments', appointmentsRouter);
app.use('/api/alexa', alexaRouter);
app.use('/api/chat', chatRouter);
app.use('/api/assistant-settings', assistantSettingsRouter);
app.use('/api/morning-checkin', morningCheckinRouter);
app.use('/api/look-back', lookBackRouter);

// 5:30 AM — pull next 7 days of triggers from Google Calendar
cron.schedule('30 5 * * *', () => {
  console.log('[cron] ingesting calendar triggers');
  void ingestCalendarTriggers();
});

// Hourly — reconcile linked Google Calendar appointments against routine
// state (catches reschedules/deletions/past-completions). Skipped when
// Calendar isn't configured. See §47 Phase 4 + §50 Phase C (Alexa reminders
// pass removed).
cron.schedule('0 * * * *', () => {
  void reconcileAppointmentsCron();
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`[api] listening on :${port}`);
});
