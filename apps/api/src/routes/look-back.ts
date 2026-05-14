import { Router } from 'express';
import { detectPatterns } from '../services/patterns-simple.js';

/**
 * §50 Phase D — Look Back endpoints.
 *
 *   GET /api/look-back/patterns?days=N
 *     Returns the array of patterns the surfacer found in the last N days.
 *     Empty array means "nothing worth surfacing right now"; the dashboard
 *     hides the section in that case.
 *
 * The other two Look Back sections ("This week" and "This month") compose
 * from existing endpoints (`/api/morning-checkin`, `/api/workouts`,
 * `/api/finance/profile`, `/api/finance/imports`) so there's no
 * `/api/look-back/this-week` or `/api/look-back/this-month` here. Resist
 * adding them unless the dashboard genuinely needs a server-side rollup.
 */

const router: Router = Router();

router.get('/patterns', async (req, res) => {
  const raw = req.query.days;
  const days = typeof raw === 'string' ? Number(raw) : 30;
  res.json(await detectPatterns(Number.isFinite(days) ? days : 30));
});

export default router;
