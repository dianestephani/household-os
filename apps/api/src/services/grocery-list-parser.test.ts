import { describe, it, expect } from 'vitest';
import {
  dedupeGroceryItems,
  parseGroceryList,
} from './grocery-list-parser.js';

describe('parseGroceryList', () => {
  it('returns [] for empty or non-string input', () => {
    expect(parseGroceryList('')).toEqual([]);
    expect(parseGroceryList(undefined as unknown as string)).toEqual([]);
  });

  it('parses sections + items in the canonical Grocery Manager format', () => {
    const raw = [
      'GROCERY LIST',
      '## Produce',
      '- 1 lb baby spinach',
      '- 2 lemons',
      '',
      '## Frozen',
      "- 2 bags TJ's frozen rice",
    ].join('\n');
    const items = parseGroceryList(raw);
    expect(items.length).toBe(3);
    expect(items[0]).toEqual({ text: '1 lb baby spinach', section: 'Produce' });
    expect(items[1]).toEqual({ text: '2 lemons', section: 'Produce' });
    expect(items[2]).toEqual({
      text: "2 bags TJ's frozen rice",
      section: 'Frozen',
    });
  });

  it('handles bullets with * or • as alternatives to -', () => {
    const items = parseGroceryList(['* apples', '• bananas'].join('\n'));
    expect(items.map((i) => i.text)).toEqual(['apples', 'bananas']);
  });

  it('handles items with no section (null)', () => {
    const items = parseGroceryList('- bread\n- milk');
    expect(items[0]?.section).toBeNull();
    expect(items[1]?.section).toBeNull();
  });

  it('ignores ```fences``` and the optional "GROCERY LIST" title', () => {
    const raw = [
      '```',
      'GROCERY LIST',
      '- eggs',
      '```',
    ].join('\n');
    const items = parseGroceryList(raw);
    expect(items.length).toBe(1);
    expect(items[0]?.text).toBe('eggs');
  });

  it('preserves section state across blank lines', () => {
    const items = parseGroceryList(
      ['## Produce', '', '- spinach', '', '', '- kale'].join('\n'),
    );
    expect(items.every((i) => i.section === 'Produce')).toBe(true);
  });

  it('drops items with empty text after trim', () => {
    const items = parseGroceryList(['## X', '-   ', '- real item'].join('\n'));
    expect(items.length).toBe(1);
    expect(items[0]?.text).toBe('real item');
  });

  it('parses h1-h6 markdown headers as sections', () => {
    const items = parseGroceryList(
      ['# Big', '- a', '### Medium', '- b'].join('\n'),
    );
    expect(items[0]?.section).toBe('Big');
    expect(items[1]?.section).toBe('Medium');
  });
});

describe('dedupeGroceryItems', () => {
  it('removes case-insensitive duplicates, preserving first occurrence', () => {
    const out = dedupeGroceryItems([
      { text: 'Eggs', section: 'Dairy' },
      { text: 'milk', section: 'Dairy' },
      { text: 'eggs', section: 'Pantry' },
      { text: 'MILK', section: null },
    ]);
    expect(out.map((i) => i.text)).toEqual(['Eggs', 'milk']);
    // Preserves the section from the first occurrence
    expect(out[0]?.section).toBe('Dairy');
  });

  it('returns input unchanged when nothing duplicates', () => {
    const items = [
      { text: 'a', section: null },
      { text: 'b', section: null },
    ];
    expect(dedupeGroceryItems(items)).toEqual(items);
  });
});
