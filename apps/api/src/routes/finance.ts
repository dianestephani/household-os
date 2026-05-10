import { Router } from 'express';
import {
  affordabilityReport,
  estimateMonthlyTax,
  getFinancialProfile,
  listOutsourceable,
  setFinancialProfile,
} from '../services/finance.js';
import type { FilingStatus } from '@household-os/shared/types';

const router: Router = Router();

router.get('/profile', async (_req, res) => {
  res.json(await getFinancialProfile());
});

router.patch('/profile', async (req, res) => {
  const body = (req.body ?? {}) as {
    monthly_gross_income?: number;
    monthly_tax_estimate?: number;
    monthly_fixed_expenses?: number;
    state?: string;
    filing_status?: FilingStatus;
    monthly_extra_withholding?: number;
    notes?: string;
    expense_breakdown?: string;
  };
  res.json(await setFinancialProfile(body));
});

router.get('/outsourceable', async (_req, res) => {
  res.json(await listOutsourceable());
});

router.get('/affordability', async (_req, res) => {
  res.json(await affordabilityReport());
});

/**
 * Compute a tax-withholding estimate given gross income, state, filing status,
 * and any extra monthly withholding. Returns a breakdown the dashboard can
 * surface and the persona can reason about. Pure compute; doesn't persist.
 */
router.post('/estimate-tax', async (req, res) => {
  const body = (req.body ?? {}) as {
    monthly_gross_income?: number;
    state?: string;
    filing_status?: FilingStatus;
    monthly_extra_withholding?: number;
  };
  res.json(
    estimateMonthlyTax({
      monthly_gross_income: body.monthly_gross_income ?? 0,
      state: body.state ?? '',
      filing_status: body.filing_status ?? 'single',
      monthly_extra_withholding: body.monthly_extra_withholding ?? 0,
    }),
  );
});

export default router;
