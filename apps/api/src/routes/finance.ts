import { Router } from 'express';
import {
  affordabilityReport,
  getFinancialProfile,
  listOutsourceable,
  setFinancialProfile,
} from '../services/finance.js';

const router: Router = Router();

router.get('/profile', async (_req, res) => {
  res.json(await getFinancialProfile());
});

router.patch('/profile', async (req, res) => {
  const body = (req.body ?? {}) as {
    monthly_income?: number;
    monthly_fixed_expenses?: number;
    notes?: string;
  };
  res.json(await setFinancialProfile(body));
});

router.get('/outsourceable', async (_req, res) => {
  res.json(await listOutsourceable());
});

router.get('/affordability', async (_req, res) => {
  res.json(await affordabilityReport());
});

export default router;
