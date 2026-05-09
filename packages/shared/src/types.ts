export type EnergyLevel = 'low' | 'medium' | 'high';

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

export type DeferReason = 'energy_drop' | 'manual_swap' | 'over_budget';

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

export interface EnergyLog {
  _id?: string;
  ts: Date | string;
  level: EnergyLevel;
  source: 'voice' | 'dashboard' | 'shortcut' | 'cron-default';
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
}

export interface InventoryFixedRoutine {
  key: string;
  name: string;
  day: DayOfWeek;
  time_window: string;
  estimate_minutes: number;
  energy: EnergyLevel;
  biweekly?: boolean;
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
}

export interface InventoryEventDriven {
  key: string;
  name: string;
  trigger: string;
  estimate_minutes: number;
  energy: EnergyLevel;
  also_triggers?: string[];
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
