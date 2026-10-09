export type Compound = "SOFT" | "MEDIUM" | "HARD" | "WET";
export type RaceStatus = "idle" | "running" | "paused" | "finished";

export interface LapRecord {
  lap: number; lap_time_s: number; compound: Compound; wear_end: number; fuel_end_kg: number;
  wetness: number; safety_car: boolean; pitted: boolean; pit_loss_s: number; new_compound: Compound | null;
  components: { base: number; fuel: number; compound: number; wear: number; weather: number;
    traffic: number; event: number; noise: number; fuel_save: number; driver?: number };
}
export interface Stint { compound: Compound; start_lap: number; end_lap: number | null }
export interface PlanStop { lap: number; compound: Compound }
export interface ProjectionPoint { lap: number; lap_time_s: number; wear: number; fuel_kg: number; compound: Compound }
export interface CandidateSummary { plan: PlanStop[]; expected_s: number; p10_s: number; p90_s: number }
export interface ActionOption { action: "BOX_THIS_LAP" | "STAY_OUT"; best_plan: PlanStop[] | null; projected_finish_s: number | null }

export interface Recommendation {
  action: "BOX_THIS_LAP" | "STAY_OUT"; pit_lap: number | null; compound: Compound | null;
  plan: PlanStop[]; projected_finish_s: number;
  current_plan: PlanStop[] | null; current_plan_projected_finish_s: number | null;
  best_alternative: CandidateSummary | null; time_advantage_s: number;
  action_options: ActionOption[]; top_candidates: CandidateSummary[];
  candidates_evaluated: number; candidates_feasible: number; scenarios: number;
  scenario_win_share: number; trigger: string; explanation: string; warnings: string[];
  computed_at_lap: number; decision_ms: number; projection: ProjectionPoint[];
}

export interface RaceEvent { id: number; lap: number; type: string; message: string; sim_time_s: number }

export interface CarState {
  fuel_kg: number; fuel_initial_kg: number; fuel_status: "OK" | "LOW" | "CRITICAL";
  fuel_projected_end_kg: number; compound: Compound; tyre_wear: number; tyre_age: number;
  last_lap_s: number | null; best_lap_s: number | null; pit_stops: number;
  compounds_used: Compound[]; tyres_available: Record<string, number>;
}
export interface Conditions {
  track_wetness: number; rain_intensity: number; weather: "DRY" | "DAMP" | "WET";
  safety_car: boolean; sc_laps_elapsed: number;
}
export interface BaselineShadow {
  elapsed_s: number; compound: Compound; tyre_wear: number; pit_stops: number; gap_s: number;
  laps: { lap: number; lap_time_s: number; compound: Compound; pitted: boolean; pit_loss_s: number }[]; stints: Stint[];
}
export interface CarLap {
  lap: number; lap_time_s: number; elapsed_s: number; pitted: boolean; pit_loss_s: number;
  compound: Compound; safety_car: boolean;
}
export interface CarSummary {
  id: string; code: string; name: string; color: string; is_primary: boolean; simulated: boolean;
  grid_slot: number; pace_offset_s: number; laps: CarLap[]; elapsed_s: number; compound: Compound;
  tyre_wear: number; tyre_age: number; fuel_kg: number; pit_stops: number; last_lap_s: number | null;
  position: number; gap_to_leader_s: number;
}
export interface RaceState {
  version: number; status: RaceStatus; config_name: string; seed: number; lap: number; total_laps: number;
  max_wear: number; circuit_id: string; pit_service_ratio: number; cars: CarSummary[]; elapsed_s: number; speed: number; replan_count: number;
  car: CarState; conditions: Conditions; laps: LapRecord[]; stints: Stint[];
  recommendation: Recommendation | null; events: RaceEvent[]; baseline: BaselineShadow | null;
}

export interface TrialResult {
  seed: number; baseline_s: number | null; adaptive_s: number | null; saved_s: number | null;
  winner: "ADAPTIVE" | "BASELINE" | "TIE"; baseline_stops: number; adaptive_stops: number;
  replans: number; mean_decision_ms: number; max_decision_ms: number; fuel_failures: number;
  tyre_violations: number; invalid_plans: number; baseline_invalid_plans: number;
  baseline_tyre_violations: number; completed: boolean; category: string; error: string | null;
}
export interface BenchmarkSummary {
  trials: number; completed: number; failed_trials: number; seed_start: number; seed_set: "eval" | "dev";
  scenarios: number; baseline_mean_s: number; adaptive_mean_s: number; mean_saved_s: number;
  median_saved_s: number; std_saved_s: number; ci95_saved_s: [number, number]; pct_improvement: number;
  win_rate: number; wins: number; losses: number; ties: number; invalid_plans: number;
  baseline_invalid_plans: number; tyre_violations: number; baseline_tyre_violations: number;
  fuel_failures: number; mean_decision_ms: number; p95_decision_ms: number;
  by_category: Record<string, { n: number; mean_saved_s: number; win_rate: number; loss_rate: number }>;
  runtime_s: number; created_at: string; config_name: string;
}
export interface BenchmarkResults { summary: BenchmarkSummary; trials: TrialResult[] }
export interface BenchmarkStatus { state: "idle" | "running" | "done" | "error"; completed: number; total: number; error: string | null }

export type EventRequest =
  | { type: "RAIN"; intensity: number } | { type: "CLEAR" } | { type: "SC_DEPLOY" } | { type: "SC_WITHDRAW" };
