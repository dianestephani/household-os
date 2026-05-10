export type EnergyLevel = 'low' | 'medium' | 'high';

export type MoodLevel = 'good' | 'neutral' | 'down';

export type DeferReasonCode =
  | 'tired'
  | 'not_in_mood'
  | 'out_of_time'
  | 'over_budget'
  | 'manual_swap'
  | 'energy_drop'
  | 'other';

export type WorkoutStatus = 'done' | 'skipped' | 'partial';

export type WorkoutSlotKey = 'pt_tue' | 'pt_thu' | 'lift_flex' | 'ad_hoc';

export type DayType =
  | 'day_off'
  | 'catering_day'
  | 'weekday_default'
  | 'tue_thu_pt';

export type Category =
  | 'pet'
  | 'cleaning'
  | 'trash'
  | 'airbnb'
  | 'dogsit'
  | 'personal';

export type Zone =
  | 'kitchen'
  | 'bathrooms'
  | 'common'
  | 'bedroom'
  | 'yard'
  | 'whole-house';

export type DayOfWeek = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export type SchedulingType =
  | 'rolling'
  | 'fixed'
  | 'as_needed'
  | 'event_driven'
  | 'zone_rotation';

export interface Scheduling {
  type: SchedulingType;
  interval_days?: number;
  flex_days?: number;
  day_of_week?: DayOfWeek;
  biweekly?: boolean;
  trigger?: string;
  week_in_cycle?: number;
}

export interface Routine {
  _id?: string;
  key: string;
  name: string;
  category: Category;
  zone: Zone;
  scheduling: Scheduling;
  estimate_minutes: number;
  energy: EnergyLevel;
  skip_if?: string;
  also_triggers?: string[];
  last_done?: Date | string | null;
  active: boolean;
  /**
   * Whether this routine is something Diane could plausibly outsource (cleaner,
   * pet sitter, lawn service, wash-and-fold, Airbnb cleaner, etc.). Default
   * false; system seeds reasonable defaults from the inventory.
   */
  outsourceable?: boolean;
  /** Typical local-market cost per occurrence in USD. */
  outsource_cost_estimate?: number;
}

// ----- Finance -----

export type FilingStatus = 'single' | 'married_jointly' | 'head_of_household';

export interface FinancialProfile {
  _id?: string;
  /** Singleton key — only one profile per system. */
  key: 'self';
  /** Monthly gross income (pre-tax) across all jobs. */
  monthly_gross_income: number;
  /** Monthly tax withholding estimate. Auto-fillable; manually overridable. */
  monthly_tax_estimate: number;
  /** Monthly fixed expenses (rent, insurance, subscriptions, etc.) */
  monthly_fixed_expenses: number;
  /** Two-letter state code (e.g. WA, CA) — drives state-tax in the estimator. */
  state?: string;
  filing_status?: FilingStatus;
  /** Total monthly extra withholding across all paychecks, in dollars. */
  monthly_extra_withholding?: number;
  /** Any extra notes Diane wants to keep alongside the numbers. */
  notes?: string;
  /**
   * Free-form RocketMoney-derived context. Diane pastes whatever summary feels
   * useful — category breakdown, recurring subscriptions, top spending lines,
   * income split, etc. The Finance persona reads this as additional grounding
   * for affordability questions; we never parse it structurally.
   */
  expense_breakdown?: string;
  updated_at: Date | string;
}

export interface TaxEstimate {
  monthly_gross_income: number;
  state: string;
  filing_status: FilingStatus;
  monthly_extra_withholding: number;
  /** Computed components (monthly). */
  federal: number;
  fica: number;
  state_tax: number;
  extra: number;
  total: number;
  /** Effective tax rate on gross. */
  effective_rate: number;
  notes: string;
}

export interface OutsourceableSummaryItem {
  routine_key: string;
  routine_name: string;
  cost_per_occurrence: number;
  occurrences_per_month: number;
  monthly_cost: number;
}

export interface OutsourceableSummary {
  total_monthly_cost: number;
  items: OutsourceableSummaryItem[];
}

export type ItemStatus = 'pending' | 'in_progress' | 'done' | 'deferred';

export interface PlanItem {
  routine_key: string;
  name: string;
  estimate_minutes: number;
  energy: EnergyLevel;
  status: ItemStatus;
  order: number;
  completed_at?: Date | string | null;
}

/**
 * Subset of {@link DeferReasonCode} that the in-plan swap_pool tracks.
 * Richer reasons (`tired`, `not_in_mood`, `out_of_time`) live on the
 * persistent {@link DeferralEvent} record.
 */
export type DeferReason = DeferReasonCode;

export interface SwapPoolItem {
  routine_key: string;
  name: string;
  estimate_minutes: number;
  energy: EnergyLevel;
  deferred_at: Date | string;
  reason: DeferReason;
}

export interface PublisherState {
  calendar_event_id?: string | null;
  alexa_notif_id?: string | null;
  last_synced_at?: Date | string | null;
}

export interface TodayPlan {
  _id?: string;
  date: string; // YYYY-MM-DD
  day_type: DayType;
  budget_minutes: number;
  current_energy: EnergyLevel;
  items: PlanItem[];
  swap_pool: SwapPoolItem[];
  publisher: PublisherState;
}

export type WellbeingSource = 'voice' | 'dashboard' | 'shortcut' | 'cron-default';

export interface EnergyLog {
  _id?: string;
  ts: Date | string;
  level: EnergyLevel;
  source: WellbeingSource;
}

export interface MoodLog {
  _id?: string;
  ts: Date | string;
  level: MoodLevel;
  source: WellbeingSource;
}

export interface DeferralEvent {
  _id?: string;
  ts: Date | string;
  date: string; // YYYY-MM-DD the routine was deferred FROM
  routine_key: string;
  routine_name: string;
  reason: DeferReasonCode;
  notes?: string;
  source: 'auto' | 'user';
}

export interface WorkoutLog {
  _id?: string;
  ts: Date | string;
  date: string; // YYYY-MM-DD
  slot_key: WorkoutSlotKey;
  status: WorkoutStatus;
  mood?: MoodLevel;
  energy?: EnergyLevel;
  notes?: string;
}

export interface DeferralPattern {
  routine_key: string;
  routine_name: string;
  count: number;
  window_days: number;
  reasons: Partial<Record<DeferReasonCode, number>>;
  last_deferred_at: Date | string;
}

export interface WorkoutPattern {
  window_days: number;
  scheduled: number;
  done: number;
  skipped: number;
  partial: number;
  recent_streaks: { kind: 'done' | 'skipped'; length: number }[];
}

// ----- Activity log -----

export type ActivityKind =
  | 'task_done'
  | 'task_deferred'
  | 'task_swapped'
  | 'task_pulled'
  | 'task_created'
  | 'task_cancelled'
  | 'plan_generated'
  | 'plan_regenerated'
  | 'energy_logged'
  | 'mood_logged'
  | 'workout_logged'
  | 'zone_assessed'
  | 'check_in_created'
  | 'check_in_answered'
  | 'check_in_skipped'
  | 'trigger_added'
  | 'routine_edited'
  | 'context_logged';

export type ActivityActor = 'user' | 'system' | 'cron';

export interface ActivityLogEntry {
  _id?: string;
  ts: Date | string;
  kind: ActivityKind;
  /** Human-readable summary for the timeline display. */
  summary: string;
  actor: ActivityActor;
  /** Optional structured metadata for analytics / dashboards. */
  metadata?: Record<string, unknown>;
}

// ----- Context journal -----

/**
 * Append-only narrative journal shared by both personas. Lets Diane (or a
 * persona on her behalf) drop qualitative context — "5 dogs today, exhausted,
 * couldn't leave the house" — that the system can reason about later.
 *
 * Structured fields are optional but encouraged: they make the entries
 * queryable for patterns (e.g. "high dogsit_count days correlate with low
 * energy and skipped workouts") rather than just LLM-readable prose.
 */
export type ContextRelatedPersona = 'household' | 'finance' | 'both';

export type ContextSource = 'voice' | 'dashboard' | 'persona' | 'api';

export interface ContextEntry {
  _id?: string;
  ts: Date | string;
  /** Required free-form narrative — the truth of record. */
  text: string;
  /** Free-form descriptive labels (e.g. ["dogsit-stress", "weather"]). */
  tags?: string[];
  energy?: EnergyLevel;
  mood?: MoodLevel;
  /** How many guest dogs are present (excluding Diane's own 2). */
  dogsit_count?: number;
  /**
   * Activities the user said she couldn't / didn't do because of context.
   * Free-form strings (e.g. "workout", "errands", "leave_house").
   */
  blocked_activities?: string[];
  /** Which persona this entry is most relevant to. Default 'both'. */
  related_persona?: ContextRelatedPersona;
  source: ContextSource;
}

/** Input shape used by the service / API / personas to add an entry. */
export interface ContextEntryInput {
  text: string;
  tags?: string[];
  energy?: EnergyLevel;
  mood?: MoodLevel;
  dogsit_count?: number;
  blocked_activities?: string[];
  related_persona?: ContextRelatedPersona;
  source?: ContextSource;
}

// ----- Check-ins -----

export type CheckInType =
  | 'morning_intent'
  | 'evening_retro'
  | 'weekly_review'
  | 'pattern_interrupt'
  | 'zone_assessment';

export type ZoneStateLevel = 'fine' | 'meh' | 'rough';

export interface ZoneAssessment {
  _id?: string;
  ts: Date | string;
  zone: Zone;
  level: ZoneStateLevel;
  notes?: string;
  source_checkin_id?: string;
}

export type AdHocTaskStatus = 'open' | 'done' | 'cancelled';

export interface AdHocTask {
  _id?: string;
  ts: Date | string;
  zone: Zone;
  name: string;
  source: 'zone_assessment';
  source_assessment_id?: string;
  severity: ZoneStateLevel;
  estimate_minutes: number;
  energy: EnergyLevel;
  status: AdHocTaskStatus;
  done_at?: Date | string | null;
}

export type CheckInStatus = 'pending' | 'answered' | 'skipped' | 'expired';

export type QuestionType = 'text' | 'choice' | 'mood' | 'energy';

export interface CheckInQuestion {
  /** Stable id used to track answers longitudinally — e.g. `one_thing_today`. */
  id: string;
  text: string;
  type: QuestionType;
  /** Required for `choice` questions. */
  choices?: { value: string; label: string }[];
  /** The user's response. Shape depends on `type`. */
  answer?: string | null;
  /**
   * Optional side-effect to apply on answer. The service routes mood/energy
   * answers into MoodLog/EnergyLog as well as storing them on the CheckIn.
   */
  side_effect?: 'log_mood' | 'log_energy';
}

export interface PatternInterruptContext {
  kind: 'frequent_deferral' | 'missed_workouts';
  routine_key?: string;
  routine_name?: string;
  count?: number;
  window_days?: number;
}

export interface ZoneAssessmentContext {
  kind: 'zone_assessment';
  zone: Zone;
}

export type CheckInContext = PatternInterruptContext | ZoneAssessmentContext;

export interface CheckIn {
  _id?: string;
  type: CheckInType;
  /** When the prompt is intended for. Used for ordering + expiry. */
  scheduled_for: Date | string;
  status: CheckInStatus;
  questions: CheckInQuestion[];
  context?: CheckInContext;
  answered_at?: Date | string | null;
  created_at: Date | string;
}

export type TriggerType =
  | 'airbnb_checkin'
  | 'airbnb_checkout'
  | 'dogsit_arrival'
  | 'dogsit_departure'
  | 'landscaper'
  | 'cleaner_visit';

export interface Trigger {
  _id?: string;
  type: TriggerType;
  date: string; // YYYY-MM-DD
  source: 'calendar' | 'manual';
  source_event_id?: string;
  ingested_at: Date | string;
  notes?: string;
}

export interface EnergySuggestion {
  level: EnergyLevel;
  suggested_swaps_in: { routine_key: string; name: string; estimate_minutes: number; energy: EnergyLevel }[];
  suggested_swaps_out: { routine_key: string; name: string; estimate_minutes: number; energy: EnergyLevel }[];
  rationale: string;
}

// ----- inventory.json typing -----
export interface InventoryRollingRoutine {
  key: string;
  name: string;
  category: Category;
  zone: Zone;
  interval_days: number;
  flex_days: number;
  estimate_minutes: number;
  energy: EnergyLevel;
  skip_if?: string;
  outsourceable?: boolean;
  outsource_cost_estimate?: number;
}

export interface InventoryFixedRoutine {
  key: string;
  name: string;
  day: DayOfWeek;
  time_window: string;
  estimate_minutes: number;
  energy: EnergyLevel;
  biweekly?: boolean;
  outsourceable?: boolean;
  outsource_cost_estimate?: number;
}

export interface InventoryZoneWeek {
  week: number;
  task: string | null;
  estimate_minutes: number;
  energy: EnergyLevel;
}

export interface InventoryAsNeeded {
  key: string;
  name: string;
  trigger: string;
  estimate_minutes: number;
  energy: EnergyLevel;
  blocking?: boolean;
  outsourceable?: boolean;
  outsource_cost_estimate?: number;
}

export interface InventoryEventDriven {
  key: string;
  name: string;
  trigger: string;
  estimate_minutes: number;
  energy: EnergyLevel;
  also_triggers?: string[];
  outsourceable?: boolean;
  outsource_cost_estimate?: number;
}

export interface InventoryProtectedSlot {
  key: string;
  name: string;
  day: string;
  time?: string;
  type: string;
  count?: number;
}

export interface Inventory {
  energy_budgets_minutes: Record<DayType, number>;
  rolling_routines: InventoryRollingRoutine[];
  fixed_routines: InventoryFixedRoutine[];
  zone_rotation_6wk: InventoryZoneWeek[];
  as_needed_routines: InventoryAsNeeded[];
  event_driven_routines: InventoryEventDriven[];
  protected_slots: InventoryProtectedSlot[];
}

// ----- Persona config -----
export interface PersonaToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface PersonaConfig {
  name: string;
  model: string;
  systemPrompt: string;
  tools: PersonaToolDef[];
  stub?: boolean;
}
