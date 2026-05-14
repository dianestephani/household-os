import type { PersonaToolDef } from '../types.js';

/**
 * Unified assistant — replaces the three-persona split (household / finance /
 * grocery) per §50 of HANDOFF.md. One assistant with read access to
 * everything; tools are wired by their respective Phase. Phase A wires the
 * subset that maps onto existing services; Phase B adds morning-checkin
 * tools; Phase E adds projected-income + cadence-shift behavior.
 *
 * Seed system prompt lives here and is also the default `AssistantSettings`
 * record. Diane edits the LIVE prompt in Stuff/Assistant Settings; this
 * constant is what "Reset to seed" restores to.
 */

export const ASSISTANT_SYSTEM_PROMPT = `
You are Diane's personal household assistant. Be concise, casual, grounded
in current data — call tools to look up real values rather than guessing.

About Diane:
- 34, lives alone in a 3BR rental with 2 dogs and 2 cats. Frequently
  dogsits up to 5+ guest dogs at once.
- Five income streams: One More Game (engineering/QA, primary), catering
  gigs (often weekends), dogsitting, Airbnb spare rooms, personal training
  (Tue/Thu mornings at a local gym — regular client 9 AM both days,
  semi-regular client 10 AM Tue 3 of 4 weeks).
- 5'4", ~148 lbs, working toward -5kg and -5 inches off waist.
- Has a hyperfixate-then-burnout pattern with side projects — prefer
  simple low-maintenance suggestions over elaborate systems.

Diet (hard rules):
- No seafood ever, including dishes with seafood ingredients.
- Won't cook or handle raw meat — won't buy it either.
- Eggs and dairy irritate her stomach. Use sparingly, not as primary
  protein vehicles.
- High protein preferred. Trader Joe's precooked options are staples.

Shopping (physical trips only, no Amazon Prime):
- Costco list (~$225-250 per run): gas, toilet paper, paper towels,
  air fresheners, cat litter, cat food, dog food. This list is fixed.
- Trader Joe's: primary grocery store, almost everything else.
- QFC: secondary/backup.

Cleaning crew: every 3-4 weeks, $380/visit (~$4,900-6,600/year). The
3-vs-4-week cadence question is a recurring budget decision. When she
asks, call get_financial_profile + affordability_report and answer
grounded in real numbers.

Workouts: 3x/week strength training target. She's a trainer and writes
her own programs — never prescribe workouts. Tue/Thu mornings she's at
the gym for client sessions; her own slot is BEFORE those (~7:45 AM).
Post-session workouts essentially don't happen — don't suggest them.

Tone:
- Casual, no over-explaining
- Don't moralize about spending
- Never push streaks, scores, or "did you work out today" nags
- Mood/energy/awakeness data exists for HER introspection. Surface
  patterns when asked (recent_checkins + recent_workouts). Don't
  volunteer them as advice.

Behavior:
- Call get_calendar_today near the start of conversations about plans.
- Call recent_checkins if she mentions feeling off or having skipped
  something.
- Call get_financial_profile + affordability_report for any
  "can I afford X" question. Never speculate on her budget.
- When she describes a new recurring item ("I need to clean the gutters
  every 6 months"), propose a routine and offer to create it via
  create_routine.
- When she reschedules an appointment, ASK which cadence-shift strategy
  to apply: 'one_off', 'shift_all', or 'skip_one'. Don't assume.
`.trim();

export const ASSISTANT_MODEL = 'claude-sonnet-4-6';

/**
 * Tool definitions wired in Phase A. Tools whose service support arrives in
 * a later phase are listed in `DEFERRED_TOOL_NAMES` below — kept out of the
 * live API surface but tracked here so the spec list in HANDOFF §50 stays
 * traceable.
 */
export const ASSISTANT_TOOLS: PersonaToolDef[] = [
  {
    name: 'get_calendar_today',
    description:
      "Today's Google Calendar events for Diane's connected calendar. Returns " +
      "{date, connected, events[], open_in_calendar_url}. Use at the start of " +
      'plan-shaped conversations to ground in what is actually on her schedule.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_calendar_range',
    description:
      'Upcoming Calendar events + routines coming due over the next N days ' +
      '(default 7, max 60). Use for week-ahead questions.',
    input_schema: {
      type: 'object',
      properties: {
        days: { type: 'integer', description: 'Window in days. Default 7.' },
      },
    },
  },
  {
    name: 'list_routines',
    description:
      "List all of Diane's routines (recurring + appointment-style). Filter " +
      "by category and/or active flag. Returns full Routine docs including " +
      'scheduling, cadence, appointment block, outsourceable cost.',
    input_schema: {
      type: 'object',
      properties: {
        category: { type: 'string' },
        active: {
          type: 'boolean',
          description: 'Defaults to true. Pass false to include soft-deleted.',
        },
      },
    },
  },
  {
    name: 'create_routine',
    description:
      'Add a new routine. Use when Diane describes something recurring she ' +
      "wants tracked (e.g. 'clean the gutters every 6 months'). Required: " +
      'key (short stable id, snake_case), name, category, scheduling.type. ' +
      'For rolling routines also pass scheduling.interval_days. ' +
      'Confirm fields before calling — never invent a key without asking.',
    input_schema: {
      type: 'object',
      properties: {
        key: { type: 'string' },
        name: { type: 'string' },
        category: { type: 'string' },
        zone: { type: 'string' },
        scheduling: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['rolling', 'fixed', 'as_needed', 'event_driven'] },
            interval_days: { type: 'integer' },
            day_of_week: { type: 'string' },
            biweekly: { type: 'boolean' },
            trigger: { type: 'string' },
          },
        },
        estimate_minutes: { type: 'integer' },
        outsourceable: { type: 'boolean' },
        outsource_cost_estimate: { type: 'number' },
        monthly_occurrences_override: {
          type: 'number',
          description:
            "Override for the outsourceable cost math. Use when the routine's interval doesn't match real-world booking cadence.",
        },
      },
      required: ['key', 'name'],
    },
  },
  {
    name: 'update_routine',
    description:
      "Patch a routine's cadence, estimate, outsource fields, or active flag. " +
      'Pass `key`, a `patch` object with the fields to change, and an ' +
      'optional `cadence_shift_strategy` for appointment-enabled routines. ' +
      "Strategies: 'shift_all' (default — cadence change applies forward), " +
      "'skip_one' (clears the upcoming Calendar event; interval_days " +
      "unchanged), 'one_off' (no side effects beyond the patch; signals " +
      'this is a one-time tweak rather than a cadence change). ALWAYS ' +
      'ask Diane which strategy she wants if her message is ambiguous.',
    input_schema: {
      type: 'object',
      properties: {
        key: { type: 'string' },
        patch: { type: 'object' },
        cadence_shift_strategy: {
          type: 'string',
          enum: ['one_off', 'shift_all', 'skip_one'],
        },
      },
      required: ['key', 'patch'],
    },
  },
  {
    name: 'delete_routine',
    description:
      'Soft-delete a routine (sets active=false). The doc is preserved so ' +
      'history + activity entries keep resolving.',
    input_schema: {
      type: 'object',
      properties: { key: { type: 'string' } },
      required: ['key'],
    },
  },
  {
    name: 'log_workout',
    description:
      'Retroactive workout log. slot_key is pt_tue / pt_thu / lift_flex / ' +
      "ad_hoc; status is done / skipped / partial. Use when she mentions a " +
      "workout she did (or didn't). Never prescribe — she's a trainer.",
    input_schema: {
      type: 'object',
      properties: {
        slot_key: {
          type: 'string',
          enum: ['pt_tue', 'pt_thu', 'lift_flex', 'ad_hoc'],
        },
        status: { type: 'string', enum: ['done', 'skipped', 'partial'] },
        notes: { type: 'string' },
      },
      required: ['slot_key', 'status'],
    },
  },
  {
    name: 'recent_workouts',
    description:
      'List recent workout logs (default last 14 days). Use to ground ' +
      "introspective questions like 'how have my workouts been lately?'.",
    input_schema: {
      type: 'object',
      properties: { days: { type: 'integer' } },
    },
  },
  {
    name: 'get_financial_profile',
    description:
      'Current FinancialProfile singleton — gross income, fixed expenses, ' +
      'tax estimate, state, filing status, free-form expense_breakdown. Call ' +
      'first for any affordability or budget question.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'estimate_tax',
    description:
      'Pure compute — estimate monthly tax from gross income + state + ' +
      'filing status + monthly extra withholding. Does not persist. Returns ' +
      'federal/FICA/state/extra components, total, effective rate.',
    input_schema: {
      type: 'object',
      properties: {
        monthly_gross_income: { type: 'number' },
        state: { type: 'string' },
        filing_status: {
          type: 'string',
          enum: ['single', 'married_jointly', 'head_of_household'],
        },
        monthly_extra_withholding: { type: 'number' },
      },
      required: ['monthly_gross_income'],
    },
  },
  {
    name: 'affordability_report',
    description:
      "Greedy-fit affordability report — shows which outsourceable routines " +
      "fit within Diane's discretionary income. Always call this for " +
      "'can I afford X' questions rather than estimating from gross.",
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'list_outsourceable',
    description:
      'All routines flagged outsourceable, with cost/visit + occurrences/mo ' +
      '+ monthly cost. Sorted by monthly_cost desc.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'recent_imports',
    description:
      'Recent RocketMoney imports (paste + CSV), newest-first. Returns up ' +
      'to `limit` records (default 10, max 50).',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'integer' },
      },
    },
  },
  {
    name: 'add_rocketmoney_paste',
    description:
      "Append a free-form RocketMoney breakdown paste to import history. " +
      "Doesn't auto-apply to the profile — Diane reviews + applies in the " +
      "Stuff/Finance UI. Use when she dumps a category summary in chat.",
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string' },
      },
      required: ['text'],
    },
  },
  {
    name: 'get_morning_checkin',
    description:
      "Get Diane's morning check-in for a given date (mood + energy + " +
      "awakeness + optional note). Date defaults to today. Returns null if " +
      "she hasn't logged one yet. Call when she mentions how she's feeling " +
      "to ground the conversation in her own words from that morning.",
    input_schema: {
      type: 'object',
      properties: {
        date: {
          type: 'string',
          description: 'YYYY-MM-DD; defaults to today if omitted.',
        },
      },
    },
  },
  {
    name: 'recent_checkins',
    description:
      'Recent morning check-ins (default 14 days, max 90). Newest-first. ' +
      'Use to spot patterns when she asks how things have been going — ' +
      "never volunteer this; she's explicitly asked for introspection, not " +
      'prescription.',
    input_schema: {
      type: 'object',
      properties: { days: { type: 'integer' } },
    },
  },
  {
    name: 'set_projected_income',
    description:
      'Record the projected income number for a specific month (YYYY-MM). ' +
      'Diane projects her income on paper monthly; this is the integration ' +
      "— one number per month. Pass `amount: null` to clear that month's " +
      'override (falls back to `monthly_gross_income`). NEVER guess the ' +
      'month — ask if unclear.',
    input_schema: {
      type: 'object',
      properties: {
        month: {
          type: 'string',
          description: 'Format: YYYY-MM (e.g. "2026-05").',
        },
        amount: {
          type: ['number', 'null'],
          description:
            "Dollars projected for the month. Pass null to clear that month's override.",
        },
      },
      required: ['month', 'amount'],
    },
  },
];

/**
 * Tools listed in HANDOFF §50 but whose underlying services arrive in later
 * phases. Kept here as documentation; not added to ASSISTANT_TOOLS so the
 * model never tries to call them mid-build.
 *
 * Shipped:
 *   - get_morning_checkin   → Phase B (live)
 *   - recent_checkins       → Phase B (live)
 *   - set_projected_income  → Phase E (live)
 *   - update_routine cadence_shift_strategy → Phase E (live)
 *
 * Still deferred — deliberately, not from lack of phasing. The assistant
 * proposes calendar event changes through `update_routine` (for appointment-
 * enabled routines, which Phase 4 sync handles), or asks Diane to make the
 * change in Calendar herself. Wiring create/update/delete event tools would
 * give the assistant a parallel write path that's harder to keep coherent
 * with the appointment-reconcile cron. Add them later only if the indirect
 * path actually proves friction.
 */
export const DEFERRED_TOOL_NAMES = [
  'create_calendar_event',
  'update_calendar_event',
  'delete_calendar_event',
];

export interface AssistantConfig {
  name: string;
  model: string;
  systemPrompt: string;
  tools: PersonaToolDef[];
}

export const assistant: AssistantConfig = {
  name: 'Assistant',
  model: ASSISTANT_MODEL,
  systemPrompt: ASSISTANT_SYSTEM_PROMPT,
  tools: ASSISTANT_TOOLS,
};
