import 'dotenv/config';
import express from 'express';
import cron from 'node-cron';
import { ExpressAdapter } from 'ask-sdk-express-adapter';
import { skill as alexaSkill } from '@household-os/alexa-skill';
import { connect } from './db/connection.js';
import todayRouter from './routes/today.js';
import routinesRouter from './routes/routines.js';
import energyRouter from './routes/energy.js';
import triggersRouter from './routes/triggers.js';
import moodRouter from './routes/mood.js';
import workoutsRouter from './routes/workouts.js';
import patternsRouter from './routes/patterns.js';
import checkinsRouter from './routes/checkins.js';
import zonesRouter from './routes/zones.js';
import activityRouter from './routes/activity.js';
import financeRouter from './routes/finance.js';
import contextRouter from './routes/context.js';
import calendarRouter from './routes/calendar.js';
import scheduleRouter from './routes/schedule.js';
import dayRouter from './routes/day.js';
import tasksRouter from './routes/tasks.js';
import mealWeeksRouter from './routes/meal-weeks.js';
import appointmentsRouter from './routes/appointments.js';
import authRouter from './routes/auth.js';
import { requireToken } from './middleware/auth.js';
import { mcpAuth, mcpHandler } from './mcp/route.js';
import { generateTodayPlan } from './cron/morning-gen.js';
import { ingestCalendarTriggers } from './cron/calendar-ingest.js';
import { reconcileAppointmentsCron } from './cron/appointment-reconcile.js';
import {
  generateEveningRetro,
  generateMorningIntent,
  generatePatternInterrupts,
  generateWeeklyReview,
  generateZoneAssessment,
} from './services/checkin-generators.js';
import { publish } from './publisher/index.js';

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
 */
const verifySignature = process.env.ALEXA_SKIP_VERIFY !== '1';
const alexaAdapter = new ExpressAdapter(alexaSkill, verifySignature, verifySignature);
app.post('/alexa', alexaAdapter.getRequestHandlers());

app.use(express.json({ limit: '1mb' }));

// Login endpoint must NOT require auth (chicken-and-egg). Mount before the
// `/api` requireToken guard below.
app.use('/api/auth', authRouter);

// MCP endpoint for Claude.ai Custom Connectors. Auth via `?token=...` query
// param or Authorization header (matching API_TOKEN). Mount before the
// `/api` guard since it's at /mcp, not under /api.
app.all('/mcp', mcpAuth, mcpHandler);

app.get('/', (_req, res) => {
  res.json({
    service: 'household-os-api',
    status: 'ok',
    docs: 'https://github.com/dianestephani/household-os',
    endpoints: {
      health: '/health',
      alexa_webhook: '/alexa',
      mcp: '/mcp',
      api: [
        '/api/today',
        '/api/routines',
        '/api/energy',
        '/api/mood',
        '/api/workouts',
        '/api/zones',
        '/api/checkins',
        '/api/patterns',
        '/api/triggers',
        '/api/activity',
        '/api/finance',
        '/api/context',
        '/api/calendar',
        '/api/schedule',
        '/api/day/:YYYY-MM-DD',
        '/api/tasks',
        '/api/meal-weeks',
        '/api/appointments',
        '/api/auth/google',
      ],
    },
  });
});

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.use('/api', requireToken);
app.use('/api/today', todayRouter);
app.use('/api/routines', routinesRouter);
app.use('/api/energy', energyRouter);
app.use('/api/triggers', triggersRouter);
app.use('/api/mood', moodRouter);
app.use('/api/workouts', workoutsRouter);
app.use('/api/patterns', patternsRouter);
app.use('/api/checkins', checkinsRouter);
app.use('/api/zones', zonesRouter);
app.use('/api/activity', activityRouter);
app.use('/api/finance', financeRouter);
app.use('/api/context', contextRouter);
app.use('/api/calendar', calendarRouter);
app.use('/api/schedule', scheduleRouter);
app.use('/api/day', dayRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/meal-weeks', mealWeeksRouter);
app.use('/api/appointments', appointmentsRouter);

cron.schedule('30 5 * * *', () => {
  console.log('[cron] ingesting calendar triggers');
  void ingestCalendarTriggers();
});

cron.schedule('0 6 * * *', async () => {
  console.log('[cron] generating today plan');
  const { planId, created } = await generateTodayPlan(new Date());
  console.log(`[cron] plan ${planId} (created=${created})`);
  publish(planId);
  // Pattern interrupts piggyback on morning-gen so they're ready by 7am.
  await generatePatternInterrupts(new Date());
});

// 7:00 AM — morning intent prompt (one thing today + mood/energy)
cron.schedule('0 7 * * *', () => {
  console.log('[cron] morning intent check-in');
  void generateMorningIntent(new Date());
});

// 12:00 PM — daily zone-state rotation (one zone per day)
cron.schedule('0 12 * * *', () => {
  console.log('[cron] zone assessment check-in');
  void generateZoneAssessment(new Date());
});

// Hourly — reconcile linked Google Calendar appointments against routine
// state (catches reschedules/deletions/past-completions). Skipped when
// Calendar isn't configured. See §47 Phase 4.
cron.schedule('0 * * * *', () => {
  void reconcileAppointmentsCron();
});

// 9:00 PM — evening retro (Mon–Sat); Sunday gets weekly review instead
cron.schedule('0 21 * * 0-6', () => {
  const isSunday = new Date().getDay() === 0;
  if (isSunday) {
    console.log('[cron] weekly review check-in');
    void generateWeeklyReview(new Date());
  } else {
    console.log('[cron] evening retro check-in');
    void generateEveningRetro(new Date());
  }
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`[api] listening on :${port}`);
});
