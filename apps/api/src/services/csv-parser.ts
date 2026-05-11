import type { ParsedImport } from '@household-os/shared/types';

/**
 * Best-effort RocketMoney CSV parser. Pure function — no DB, no side effects.
 *
 * RocketMoney exports have varied shapes over time. The minimum we need:
 *   - A "Date" column (YYYY-MM-DD or M/D/YYYY)
 *   - A "Category" column
 *   - An "Amount" column (negative for outflows; we sum the absolute values
 *     of negative rows since positive rows are typically income/refunds and
 *     would skew the spending breakdown)
 *
 * Returns null when required columns are missing — the caller (route layer)
 * still persists the raw text so nothing is lost, just without the parsed
 * aggregation. Per §47 Phase 5: "If columns don't match expectation, save
 * raw + flag 'parse failed' — the raw is still in the DB."
 */

const REQUIRED_KEYS = ['date', 'category', 'amount'] as const;

interface HeaderMap {
  date: number;
  category: number;
  amount: number;
}

/** Parse a single CSV line, honoring quoted fields with embedded commas. */
export function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        cells.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}

function normalizeHeader(s: string): string {
  return s.toLowerCase().replace(/[^a-z]/g, '');
}

function findHeaders(headerCells: string[]): HeaderMap | null {
  const map: Partial<HeaderMap> = {};
  for (let i = 0; i < headerCells.length; i += 1) {
    const norm = normalizeHeader(headerCells[i] ?? '');
    if (map.date === undefined && norm === 'date') map.date = i;
    if (map.category === undefined && norm === 'category') map.category = i;
    if (map.amount === undefined && norm === 'amount') map.amount = i;
  }
  for (const k of REQUIRED_KEYS) {
    if (map[k] === undefined) return null;
  }
  return map as HeaderMap;
}

/**
 * Parse a date string into a `Date` (or null if unparseable). Accepts:
 *   - YYYY-MM-DD / YYYY/MM/DD
 *   - M/D/YYYY / MM/DD/YYYY (treated as US-format since RocketMoney is US)
 */
function buildDate(year: number, month: number, day: number): Date | null {
  // JS Date silently rolls overflow values (Feb 30 → Mar 2). Reject those
  // by round-tripping the components.
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  const dt = new Date(year, month - 1, day);
  if (Number.isNaN(dt.getTime())) return null;
  if (
    dt.getFullYear() !== year ||
    dt.getMonth() !== month - 1 ||
    dt.getDate() !== day
  ) {
    return null;
  }
  return dt;
}

export function parseImportDate(s: string): Date | null {
  const trimmed = s.trim();
  if (!trimmed) return null;

  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(trimmed);
  if (m) {
    return buildDate(Number(m[1]), Number(m[2]), Number(m[3]));
  }
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (m) {
    return buildDate(Number(m[3]), Number(m[1]), Number(m[2]));
  }
  return null;
}

/**
 * Strip currency symbols and parens-as-negatives from an amount field.
 * RocketMoney exports usually have raw numbers (-12.34) but some hand-edited
 * CSVs use ($12.34) for negatives.
 */
export function parseAmount(s: string): number | null {
  let t = s.trim();
  if (!t) return null;
  let negative = false;
  if (/^\(.*\)$/.test(t)) {
    negative = true;
    t = t.slice(1, -1);
  }
  t = t.replace(/[$,\s]/g, '');
  if (t.startsWith('-')) {
    negative = !negative;
    t = t.slice(1);
  }
  if (t.startsWith('+')) t = t.slice(1);
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = parseFloat(t);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

export function parseRocketMoneyCsv(raw: string): ParsedImport | null {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length < 2) return null;

  const headerLine = lines[0]!;
  const headers = findHeaders(parseCsvLine(headerLine));
  if (!headers) return null;

  const totals = new Map<string, { amount: number; count: number }>();
  let minDate: Date | null = null;
  let maxDate: Date | null = null;

  for (let i = 1; i < lines.length; i += 1) {
    const cells = parseCsvLine(lines[i]!);
    const rawCategory = (cells[headers.category] ?? '').trim();
    const category = rawCategory || 'Uncategorized';
    const amount = parseAmount(cells[headers.amount] ?? '');
    if (amount === null) continue;
    // Only count outflows. Positive rows are typically income/refunds and
    // don't belong in a "spending by category" breakdown.
    if (amount >= 0) continue;
    const spend = Math.abs(amount);
    const existing = totals.get(category) ?? { amount: 0, count: 0 };
    existing.amount += spend;
    existing.count += 1;
    totals.set(category, existing);

    const dt = parseImportDate(cells[headers.date] ?? '');
    if (dt) {
      if (!minDate || dt < minDate) minDate = dt;
      if (!maxDate || dt > maxDate) maxDate = dt;
    }
  }

  if (totals.size === 0) return null;

  const categories = Array.from(totals.entries())
    .map(([name, v]) => ({
      name,
      amount: Math.round(v.amount * 100) / 100,
      count: v.count,
    }))
    .sort((a, b) => b.amount - a.amount);

  const total = Math.round(
    categories.reduce((acc, c) => acc + c.amount, 0) * 100,
  ) / 100;

  const out: ParsedImport = { categories, total };
  if (minDate) out.period_start = minDate;
  if (maxDate) out.period_end = maxDate;
  return out;
}

/** Format a parsed import as readable text for the profile's expense_breakdown. */
export function formatParsedAsBreakdown(parsed: ParsedImport): string {
  const lines: string[] = [];
  if (parsed.period_start && parsed.period_end) {
    const fmt = (d: Date | string) =>
      new Date(d).toISOString().slice(0, 10);
    lines.push(`Period: ${fmt(parsed.period_start)} – ${fmt(parsed.period_end)}`);
  }
  lines.push(`Total: $${parsed.total.toFixed(2)}`);
  lines.push('');
  for (const cat of parsed.categories) {
    const countSuffix = cat.count ? ` (${cat.count} tx)` : '';
    lines.push(`${cat.name}: $${cat.amount.toFixed(2)}${countSuffix}`);
  }
  return lines.join('\n');
}
