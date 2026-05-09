import 'dotenv/config';
import express, { type Request, type Response, type NextFunction } from 'express';
import cron from 'node-cron';
import { connect } from './db/connection.js';
import todayRouter from './routes/today.js';
import routinesRouter from './routes/routines.js';
import energyRouter from './routes/energy.js';
import triggersRouter from './routes/triggers.js';
import chatRouter from './routes/chat.js';
import { generateTodayPlan } from './cron/morning-gen.js';
import { ingestCalendarTriggers } from './cron/calendar-ingest.js';
import { publish } from './publisher/index.js';

const url = process.env.MONGO_URL ?? 'mongodb://localhost:27017/household_os';
await connect(url);
console.log(`[api] connected to mongo at ${url}`);

const app = express();
app.use(express.json({ limit: '1mb' }));

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

const requireToken = (req: Request, res: Response, next: NextFunction): void => {
  const expected = process.env.API_TOKEN;
  if (!expected) {
    next();
    return;
  }
  if (req.headers.authorization !== `Bearer ${expected}`) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  next();
};

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.use('/api', requireToken);
app.use('/api/today', todayRouter);
app.use('/api/routines', routinesRouter);
app.use('/api/energy', energyRouter);
app.use('/api/triggers', triggersRouter);
app.use('/api/chat', chatRouter);

cron.schedule('30 5 * * *', () => {
  console.log('[cron] ingesting calendar triggers');
  void ingestCalendarTriggers();
});

cron.schedule('0 6 * * *', async () => {
  console.log('[cron] generating today plan');
  const { planId, created } = await generateTodayPlan(new Date());
  console.log(`[cron] plan ${planId} (created=${created})`);
  publish(planId);
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`[api] listening on :${port}`);
});
