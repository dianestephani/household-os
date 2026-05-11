import { Router } from 'express';
import {
  affordabilityReport,
  estimateMonthlyTax,
  getFinancialProfile,
  listOutsourceable,
  setFinancialProfile,
} from '../services/finance.js';
import {
  addImport,
  applyImportToProfile,
  listImports,
  listSnapshots,
  restoreSnapshot,
} from '../services/finance-history.js';
import { parseRocketMoneyCsv } from '../services/csv-parser.js';
import type { FilingStatus, ImportKind } from '@household-os/shared/types';

/** Defensive cap on raw payload size (§47 Phase 5 spec says >1MB → reject). */
const MAX_RAW_BYTES = 1_000_000;

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

// ---------- RocketMoney imports + profile snapshots (§47 Phase 5) ----------

router.get('/imports', async (req, res) => {
  const limit = Number(req.query.limit ?? 50);
  res.json(await listImports(Number.isFinite(limit) ? limit : 50));
});

/**
 * Body: `{ kind: 'paste' | 'csv', raw: string, filename?: string }`.
 * For CSV imports the server attempts to parse the raw into a `parsed`
 * aggregation; if parsing fails, the raw is still stored (no data loss)
 * and the import lands with `parsed: null`.
 */
router.post('/imports', async (req, res) => {
  try {
    const body = (req.body ?? {}) as {
      kind?: string;
      raw?: string;
      filename?: string;
    };
    if (body.kind !== 'paste' && body.kind !== 'csv') {
      res.status(400).json({ error: 'kind must be "paste" or "csv"' });
      return;
    }
    const raw = (body.raw ?? '').trim();
    if (!raw) {
      res.status(400).json({ error: 'raw text required' });
      return;
    }
    // Byte length, not character length — guards against multibyte abuse.
    if (Buffer.byteLength(raw, 'utf8') > MAX_RAW_BYTES) {
      res.status(413).json({
        error: `raw payload exceeds ${MAX_RAW_BYTES} bytes`,
      });
      return;
    }
    const parsed =
      body.kind === 'csv' ? parseRocketMoneyCsv(raw) : null;
    const result = await addImport({
      kind: body.kind as ImportKind,
      raw,
      filename: body.filename,
      parsed,
    });
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'invalid import',
    });
  }
});

router.post('/imports/:id/apply', async (req, res) => {
  try {
    res.json(await applyImportToProfile(req.params.id!));
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'apply failed';
    res.status(/not found/i.test(msg) ? 404 : 400).json({ error: msg });
  }
});

router.get('/snapshots', async (req, res) => {
  const limit = Number(req.query.limit ?? 50);
  res.json(await listSnapshots(Number.isFinite(limit) ? limit : 50));
});

router.post('/snapshots/:id/restore', async (req, res) => {
  try {
    res.json(await restoreSnapshot(req.params.id!));
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'restore failed';
    res.status(/not found/i.test(msg) ? 404 : 400).json({ error: msg });
  }
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
