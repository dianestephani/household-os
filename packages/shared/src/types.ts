/**
 * Shared types — §50 Phase C trimmed. Retired types (with their consumers)
 * removed: TodayPlan, PlanItem, SwapPoolItem, PublisherState, MoodLog,
 * EnergyLog, DeferralEvent, DeferralPattern, WorkoutPattern, MealEffort,
 * MealDay, MealWeek, ContextEntry/Input, CheckIn + all check-in question
 * shapes, ZoneAssessment, ZoneStateLevel, AdHocTask, CalendarTask, DayView,
 * ScheduleRoutineDue / ScheduleEntry / SchedulePendingAdHoc /
 * ScheduleRangeResponse, EnergySuggestion, DeferReasonCode / DeferReason,
 * WellbeingSource, DayType, ItemStatus, PersonaConfig (the three-persona
 * launcher pattern retired).
 *
 * If you need any of these for a future feature, restore from git history
 * — they were intentionally removed to shrink the surface area.
 */

export type EnergyLevel = 'low' | 'medium' | 'high';

export type MoodLevel = 'good' | 'neutral' | 'down';

/** §50 Phase B — third pulse logged alongside mood + energy each morning. */
export type AwakenessLevel = 'groggy' | 'meh' | 'alert';

export interface MorningCheckin {
  _id?: string;
  /** Local YYYY-MM-DD. Unique. */
  date: string;
  mood: MoodLevel;
  energy: EnergyLevel;
  awakeness: AwakenessLevel;
  /** Optional one-line narrative context, ≤500 chars. */
  note?: string;
  created_at?: Date | string;
  updated_at?: Date | string;
}

export interface MorningCheckinInput {
  date?: string;
  mood: MoodLevel;
  energy: EnergyLevel;
  awakeness: AwakenessLevel;
  note?: string;
}

export type WorkoutStatus = 'done' | 'skipped' | 'partial';

export type WorkoutSlotKey = 'pt_tue' | 'pt_thu' | 'lift_flex' | 'ad_hoc';

export type Category =
  | 'pet'
  | 'cleaning'
  | 'trash'
  | 'airbnb'
  | 'dogsit'
  | 'personal'
  | 'beauty';

export type Zone =
  | 'kitchen'
  | 'bathrooms'
  | 'common'
  | 'bedroom'
  | 'yard'
  | 'whole-house'
  | 'self';

export type DayOfWeek = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export type SchedulingType =
  | 'rolling'
  | 'fixed'
  | 'as_needed'
  | 'event_driven';

export interface Scheduling {
  type: SchedulingType;
  interval_days?: number;
  day_of_week?: DayOfWeek;
  biweekly?: boolean;
  trigger?: string;
}

export interface Routine {
  _id?: string;
  key: string;
  name: string;
  category: Category;
  zone: Zone;
  scheduling: Scheduling;
  estimate_minutes: number;
  last_done?: Date | string | null;
  active: boolean;
  outsourceable?: boolean;
  /** Typical local-market cost per occurrence in USD. */
  outsource_cost_estimate?: number;
  /**
   * Optional override for `listOutsourceable`'s monthly-cost math. §50 Phase E
   * — useful when the interval-based default doesn't match reality (e.g. a
   * routine with `interval_days = 21` that Diane actually books once a month;
   * setting `monthly_occurrences_override = 1` gets the right cost figure).
   */
  monthly_occurrences_override?: number;
  /**
   * Per-appointment Google Calendar event for this routine, if applicable.
   * See §47 Phase 4 + the appointment-reconcile cron.
   */
  appointment?: RoutineAppointment;
}

/** §50 Phase E — passed to `patchRoutine` when a cadence-affecting field
 *  changes. Surfaces the user's intent so the appointment side-effects can
 *  branch correctly. */
export type CadenceShiftStrategy = 'one_off' | 'shift_all' | 'skip_one';

export interface RoutineAppointment {
  enabled: boolean;
  calendar_event_id?: string;
  default_duration_minutes?: number;
  last_synced_at?: Date | string;
  /**
   * Start time of the last-known calendar event. Used by the reconcile cron
   * to detect external edits — if `event.start.dateTime` differs from this,
   * the user moved/rescheduled it in Calendar.
   */
  last_event_start?: Date | string;
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
   * income split, etc. The assistant reads this as additional grounding for
   * affordability questions; we never parse it structurally.
   */
  expense_breakdown?: string;
  /**
   * Per-month projected income overrides keyed by `YYYY-MM` (e.g.
   * `{'2026-05': 5800}`). §50 Phase E. Diane keeps her income projection on
   * paper; the app accepts a single number per month as input. When this map
   * doesn't have an entry for the queried month, callers fall back to
   * `monthly_gross_income` as the projection.
   */
  monthly_projected_income_overrides?: Record<string, number>;
  updated_at: Date | string;
}

export type SnapshotSource =
  | 'dashboard_edit'
  | 'paste_import'
  | 'csv_import'
  | 'restore';

export interface FinancialProfileSnapshot {
  _id?: string;
  ts: Date | string;
  source: SnapshotSource;
  /** Full state of the profile at the moment of save. */
  profile: FinancialProfile;
  /** If this snapshot was created by restoring a prior one, points back to it. */
  parent_snapshot_id?: string | null;
}

export type ImportKind = 'paste' | 'csv';

export interface ParsedImport {
  categories: { name: string; amount: number; count?: number }[];
  total: number;
  period_start?: Date | string;
  period_end?: Date | string;
}

export interface RocketMoneyImport {
  _id?: string;
  ts: Date | string;
  kind: ImportKind;
  /** Filename, only set when kind='csv'. */
  filename?: string;
  /** Exact content as submitted. Authoritative even if `parsed` is set. */
  raw: string;
  parsed?: ParsedImport | null;
  /** If the user clicked "Apply to profile," links to the snapshot it produced. */
  applied_to_snapshot_id?: string | null;
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

// ----- Workouts (retroactive log only after §50 Phase C) -----

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

// ----- Activity log (kept as invisible infrastructure) -----

export type ActivityKind =
  | 'workout_logged'
  | 'trigger_added'
  | 'routine_edited'
  | 'finance_import_added'
  | 'finance_snapshot_restored'
  | 'appointment_created'
  | 'appointment_rescheduled'
  | 'appointment_deleted_externally'
  | 'task_done'
  | 'morning_checkin_logged';

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

// ----- Calendar (Google Calendar passthrough for dashboard display) -----

export interface CalendarEvent {
  id: string;
  summary: string;
  /** ISO 8601 datetime for timed events; YYYY-MM-DD for all-day events. */
  start: string;
  end: string;
  is_all_day: boolean;
  location?: string;
  /** Direct deep-link to the event in Google Calendar's web UI. */
  html_link?: string;
}

export interface CalendarDayResponse {
  /** Local YYYY-MM-DD the events apply to. */
  date: string;
  /**
   * Whether Google Calendar OAuth credentials are configured. False means the
   * dashboard should render a "calendar not connected" state with setup hint.
   */
  connected: boolean;
  events: CalendarEvent[];
  /** Permalink to the user's Google Calendar at this exact day. */
  open_in_calendar_url: string;
}

// ----- Triggers (Google Calendar event ingestion) -----

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
  budget_gated?: boolean;
  cost_estimate?: number;
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
  /**
   * Energy budgets in minutes per day type. Kept on the inventory shape for
   * backward compat with the seed JSON; the §50 system no longer uses
   * day-type-driven budgets because TodayPlan retired.
   */
  energy_budgets_minutes?: Record<string, number>;
  rolling_routines: InventoryRollingRoutine[];
  fixed_routines: InventoryFixedRoutine[];
  zone_rotation_6wk: InventoryZoneWeek[];
  as_needed_routines: InventoryAsNeeded[];
  event_driven_routines: InventoryEventDriven[];
  protected_slots: InventoryProtectedSlot[];
}

// ----- Persona tool defs (used by the unified assistant in §50 Phase A) -----

export interface PersonaToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}
