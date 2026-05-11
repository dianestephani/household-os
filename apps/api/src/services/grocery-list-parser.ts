/**
 * Pure parser for the grocery-list format Grocery Manager emits (see the
 * `grocery` persona prompt). Format:
 *
 *   GROCERY LIST
 *   ## Produce
 *   - 1 lb baby spinach
 *   - 2 lemons
 *
 *   ## Frozen
 *   - 2 bags TJ's frozen rice
 *
 * Each `-` row is an item. Section headers (`## Foo`) get attached to each
 * item so the receiver can choose to group / sort. The "GROCERY LIST" header
 * line is optional and ignored if present.
 *
 * Used by the §47 Phase 6b Shopping List integration to bulk-add items to
 * Alexa's household shopping list.
 */

export interface GroceryItem {
  /** The full "1 lb baby spinach" text, suitable for Alexa Lists API. */
  text: string;
  /** Section the item appeared under (e.g. "Produce"), or null. */
  section: string | null;
}

const SECTION_RE = /^#{1,6}\s+(.+?)\s*$/;
const ITEM_RE = /^[-*•]\s+(.+?)\s*$/;

export function parseGroceryList(raw: string): GroceryItem[] {
  if (!raw || typeof raw !== 'string') return [];

  let section: string | null = null;
  const items: GroceryItem[] = [];
  const lines = raw.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^grocery list\s*$/i.test(line)) continue; // optional title line
    if (/^```/.test(line)) continue; // fenced code marker
    const sectionMatch = SECTION_RE.exec(line);
    if (sectionMatch) {
      section = sectionMatch[1]!.trim();
      continue;
    }
    const itemMatch = ITEM_RE.exec(line);
    if (itemMatch) {
      const text = itemMatch[1]!.trim();
      if (text) items.push({ text, section });
    }
  }
  return items;
}

/** Deduplicate items by case-insensitive text match, preserving first occurrence. */
export function dedupeGroceryItems(items: GroceryItem[]): GroceryItem[] {
  const seen = new Set<string>();
  const out: GroceryItem[] = [];
  for (const it of items) {
    const key = it.text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}
