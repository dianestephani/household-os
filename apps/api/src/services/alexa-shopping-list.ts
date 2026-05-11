import { getValidAccessToken } from './alexa-lwa.js';
import { logActivity } from './activity.js';

/**
 * HARD RULE — read this before extending: this module only writes to the
 * user's Alexa Household Shopping List. It NEVER:
 *   - Calls the Amazon Marketplace / Buy API
 *   - Places orders
 *   - Touches an Amazon cart
 *   - Does anything that costs money
 *
 * The shopping list is a passive checklist Diane uses while shopping in-
 * person (TJ's, Costco, QFC). If a future contributor wants to add a
 * "send to cart" feature, that's a separate decision and a separate review.
 *
 * §47 Phase 6b in HANDOFF — and the route layer reiterates this rule.
 */

const SHOPPING_LIST_NAME = 'Alexa shopping list';
const ALEXA_API_BASE = 'https://api.amazonalexa.com';

export interface AddResult {
  /** Per-item status. `error` is human-readable; `id` is Amazon's list-item id. */
  results: { text: string; status: 'added' | 'error'; id?: string; error?: string }[];
  /** How many items succeeded. */
  added: number;
  /** How many failed. */
  failed: number;
  /**
   * `'no_token'` = LWA not configured / no permission grant yet → caller
   * should route a clear 503 with operational instructions. `'ok'` = the
   * call did its real work (or no-op'd via NODE_ENV=test).
   */
  status: 'ok' | 'no_token';
}

/**
 * Add an array of free-text items (e.g. "1 lb baby spinach") to the user's
 * default shopping list. Caps total items at 100 to keep error reporting
 * useful.
 *
 * Returns per-item status. The route layer translates this into a JSON
 * response Diane's dashboard can render.
 */
export async function addItemsToShoppingList(
  items: string[],
): Promise<AddResult> {
  const cleaned = items
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, 100);

  if (cleaned.length === 0) {
    return { results: [], added: 0, failed: 0, status: 'ok' };
  }

  const creds = await getValidAccessToken();
  if (!creds) {
    return {
      results: cleaned.map((text) => ({
        text,
        status: 'error',
        error: 'Alexa list permission not configured',
      })),
      added: 0,
      failed: cleaned.length,
      status: 'no_token',
    };
  }

  // Step 1: find (or create) the shopping list.
  // Amazon returns lists scoped to the user; the default shopping list has
  // listId pattern matching the constant name SHOPPING_LIST_NAME. If we
  // can't find it we fail gracefully — falling back to creating a custom
  // list would clutter the user's account.
  const listsRes = await fetchAlexa(
    `${ALEXA_API_BASE}/v2/householdlists/`,
    'GET',
    creds.access_token,
  );
  if (!listsRes.ok) {
    return errorAll(cleaned, `lists.list failed: ${listsRes.status}`);
  }
  const listsData = (await listsRes.json()) as {
    lists?: { listId: string; name: string; state?: string }[];
  };
  const list = listsData.lists?.find(
    (l) =>
      l.name.toLowerCase() === SHOPPING_LIST_NAME.toLowerCase() &&
      l.state !== 'archived',
  );
  if (!list) {
    return errorAll(cleaned, 'Alexa shopping list not found');
  }

  // Step 2: create each item.
  const results: AddResult['results'] = [];
  for (const text of cleaned) {
    const res = await fetchAlexa(
      `${ALEXA_API_BASE}/v2/householdlists/${list.listId}/items`,
      'POST',
      creds.access_token,
      JSON.stringify({ value: text, status: 'active' }),
    );
    if (!res.ok) {
      results.push({ text, status: 'error', error: `${res.status}` });
      continue;
    }
    const data = (await res.json()) as { id?: string };
    results.push({ text, status: 'added', id: data.id });
  }

  const added = results.filter((r) => r.status === 'added').length;
  await logActivity('routine_edited', `Added ${added} item(s) to Alexa shopping list`, {
    actor: 'user',
    metadata: { surface: 'alexa_shopping_list', requested: cleaned.length, added },
  });
  return {
    results,
    added,
    failed: cleaned.length - added,
    status: 'ok',
  };
}

function errorAll(items: string[], message: string): AddResult {
  return {
    results: items.map((text) => ({ text, status: 'error', error: message })),
    added: 0,
    failed: items.length,
    status: 'ok',
  };
}

async function fetchAlexa(
  url: string,
  method: string,
  token: string,
  body?: string,
): Promise<Response> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    accept: 'application/json',
  };
  if (body) headers['content-type'] = 'application/json';
  return fetch(url, { method, headers, body });
}
