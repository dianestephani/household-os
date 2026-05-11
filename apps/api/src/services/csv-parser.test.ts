import { describe, it, expect } from 'vitest';
import {
  formatParsedAsBreakdown,
  parseAmount,
  parseCsvLine,
  parseImportDate,
  parseRocketMoneyCsv,
} from './csv-parser.js';

describe('parseCsvLine', () => {
  it('splits plain comma-separated cells', () => {
    expect(parseCsvLine('a,b,c')).toEqual(['a', 'b', 'c']);
  });

  it('respects quoted fields with embedded commas', () => {
    expect(parseCsvLine('a,"hello, world",c')).toEqual([
      'a',
      'hello, world',
      'c',
    ]);
  });

  it('unescapes doubled quotes inside a quoted field', () => {
    expect(parseCsvLine('"she said ""hi""",x')).toEqual([
      'she said "hi"',
      'x',
    ]);
  });

  it('trims whitespace around cells', () => {
    expect(parseCsvLine('a ,  b  ,c ')).toEqual(['a', 'b', 'c']);
  });

  it('returns an empty trailing cell when line ends with comma', () => {
    expect(parseCsvLine('a,b,')).toEqual(['a', 'b', '']);
  });
});

describe('parseImportDate', () => {
  it('parses YYYY-MM-DD', () => {
    const d = parseImportDate('2026-05-10');
    expect(d?.getFullYear()).toBe(2026);
    expect(d?.getMonth()).toBe(4);
    expect(d?.getDate()).toBe(10);
  });

  it('parses M/D/YYYY (US format)', () => {
    const d = parseImportDate('5/10/2026');
    expect(d?.getMonth()).toBe(4);
    expect(d?.getDate()).toBe(10);
  });

  it('returns null for unparseable strings', () => {
    expect(parseImportDate('not a date')).toBeNull();
    expect(parseImportDate('')).toBeNull();
    expect(parseImportDate('2026/13/40')).toBeNull(); // invalid month
  });
});

describe('parseAmount', () => {
  it('parses plain numbers', () => {
    expect(parseAmount('12.34')).toBe(12.34);
    expect(parseAmount('100')).toBe(100);
  });

  it('parses negatives', () => {
    expect(parseAmount('-12.34')).toBe(-12.34);
  });

  it('strips $ and commas', () => {
    expect(parseAmount('$1,234.56')).toBe(1234.56);
    expect(parseAmount('-$1,234.56')).toBe(-1234.56);
  });

  it('treats parens as negatives', () => {
    expect(parseAmount('($12.34)')).toBe(-12.34);
  });

  it('returns null for garbage', () => {
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('foo')).toBeNull();
    expect(parseAmount('1.2.3')).toBeNull();
  });
});

describe('parseRocketMoneyCsv — happy path', () => {
  const csv = [
    'Date,Description,Category,Amount',
    '2026-05-01,Trader Joe\'s,Groceries,-43.21',
    '2026-05-02,Shell Gas,Gas,-38.50',
    '2026-05-03,Trader Joe\'s,Groceries,-22.10',
    '2026-05-04,Salary,Income,4500.00',
    '2026-05-05,Refund,Groceries,12.00',
  ].join('\n');

  it('aggregates outflows by category', () => {
    const parsed = parseRocketMoneyCsv(csv);
    expect(parsed).not.toBeNull();
    const groceries = parsed!.categories.find((c) => c.name === 'Groceries');
    const gas = parsed!.categories.find((c) => c.name === 'Gas');
    expect(groceries?.amount).toBe(65.31);
    expect(groceries?.count).toBe(2);
    expect(gas?.amount).toBe(38.5);
    expect(gas?.count).toBe(1);
  });

  it('excludes positive rows (income/refunds)', () => {
    const parsed = parseRocketMoneyCsv(csv)!;
    const income = parsed.categories.find((c) => c.name === 'Income');
    expect(income).toBeUndefined();
    // The Groceries refund (+12) is also excluded; total should be 65.31 + 38.50
    expect(parsed.total).toBe(103.81);
  });

  it('sorts categories by amount desc', () => {
    const parsed = parseRocketMoneyCsv(csv)!;
    expect(parsed.categories[0]!.name).toBe('Groceries');
    expect(parsed.categories[1]!.name).toBe('Gas');
  });

  it('captures period_start / period_end from outflow rows', () => {
    const parsed = parseRocketMoneyCsv(csv)!;
    expect(parsed.period_start).toBeDefined();
    expect(parsed.period_end).toBeDefined();
    const start = new Date(parsed.period_start!);
    const end = new Date(parsed.period_end!);
    expect(start.getDate()).toBe(1);
    expect(end.getDate()).toBe(3);
  });
});

describe('parseRocketMoneyCsv — edge cases', () => {
  it('handles uncategorized rows (empty Category column)', () => {
    const csv = [
      'Date,Description,Category,Amount',
      '2026-05-01,Random charge,,-10.00',
    ].join('\n');
    const parsed = parseRocketMoneyCsv(csv)!;
    expect(parsed.categories[0]!.name).toBe('Uncategorized');
  });

  it('handles quoted descriptions with embedded commas', () => {
    const csv = [
      'Date,Description,Category,Amount',
      '2026-05-01,"Hello, world cafe",Coffee,-5.25',
    ].join('\n');
    const parsed = parseRocketMoneyCsv(csv)!;
    expect(parsed.categories[0]!.amount).toBe(5.25);
  });

  it('returns null when required columns are missing', () => {
    const csv = ['Foo,Bar', '1,2'].join('\n');
    expect(parseRocketMoneyCsv(csv)).toBeNull();
  });

  it('returns null when no outflow rows exist (only positives)', () => {
    const csv = [
      'Date,Description,Category,Amount',
      '2026-05-01,Salary,Income,4500.00',
    ].join('\n');
    expect(parseRocketMoneyCsv(csv)).toBeNull();
  });

  it('returns null on a file with only the header', () => {
    expect(parseRocketMoneyCsv('Date,Description,Category,Amount')).toBeNull();
  });

  it('tolerates extra columns and finds the right ones case-insensitively', () => {
    const csv = [
      'Date,Description,Original Description,CATEGORY,Amount,Account Name',
      '2026-05-01,X,Y,Groceries,-10.00,Checking',
    ].join('\n');
    const parsed = parseRocketMoneyCsv(csv)!;
    expect(parsed.categories[0]!.amount).toBe(10);
  });

  it('skips rows with unparseable amounts without crashing', () => {
    const csv = [
      'Date,Description,Category,Amount',
      '2026-05-01,Good row,Groceries,-10.00',
      '2026-05-02,Bad row,Groceries,not-a-number',
    ].join('\n');
    const parsed = parseRocketMoneyCsv(csv)!;
    expect(parsed.categories[0]!.amount).toBe(10);
    expect(parsed.categories[0]!.count).toBe(1);
  });
});

describe('formatParsedAsBreakdown', () => {
  it('renders categories + total + optional period range', () => {
    const text = formatParsedAsBreakdown({
      categories: [
        { name: 'Groceries', amount: 420, count: 12 },
        { name: 'Gas', amount: 80, count: 3 },
      ],
      total: 500,
      period_start: new Date('2026-04-01T00:00:00Z'),
      period_end: new Date('2026-04-30T00:00:00Z'),
    });
    expect(text).toContain('Period: 2026-04-01 – 2026-04-30');
    expect(text).toContain('Total: $500.00');
    expect(text).toContain('Groceries: $420.00 (12 tx)');
    expect(text).toContain('Gas: $80.00 (3 tx)');
  });

  it('omits the period line when dates are absent', () => {
    const text = formatParsedAsBreakdown({
      categories: [{ name: 'Misc', amount: 10 }],
      total: 10,
    });
    expect(text).not.toContain('Period:');
    expect(text).toContain('Misc: $10.00');
  });
});
