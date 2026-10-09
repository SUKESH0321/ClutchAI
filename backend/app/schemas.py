"""API models. Field names match frontend/src/types/race.ts exactly."""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

Compound = Literal["SOFT", "MEDIUM", "HARD", "WET"]


class PlanStop(BaseModel):
    lap: int
    compound: Compound


class ProjectionPoint(BaseModel):
    lap: int
    lap_time_s: float
    wear: float
    fuel_kg: float
    compound: Compound


class CandidateSummary(BaseModel):
    plan: list[PlanStop]
    expected_s: float
    p10_s: float
    p90_s: float


class ActionOption(BaseModel):
    action: Literal["BOX_THIS_LAP", "STAY_OUT"]
    best_plan: Optional[list[PlanStop]] = None
    projected_finish_s: Optional[float] = None


class Recommendation(BaseModel):
    action: Literal["BOX_THIS_LAP", "STAY_OUT"]
    pit_lap: Optional[int] = None
    compound: Optional[Compound] = None
    plan: list[PlanStop]
    projected_finish_s: float
    current_plan: Optional[list[PlanStop]] = None
    current_plan_projected_finish_s: Optional[float] = None
    best_alternative: Optional[CandidateSummary] = None
    time_advantage_s: float
    action_options: list[ActionOption]
    top_candidates: list[CandidateSummary]
    candidates_evaluated: int
    candidates_feasible: int
    scenarios: int
    scenario_win_share: float
    trigger: str
    explanation: str
    warnings: list[str]
    computed_at_lap: int
    decision_ms: float
    projection: list[ProjectionPoint]


class RaceEvent(BaseModel):
    id: int
    lap: int
    type: str
    message: str
    sim_time_s: float


class LapComponents(BaseModel):
    base: float
    fuel: float
    compound: float
    wear: float
    weather: float
    traffic: float
    event: float
    noise: float
    fuel_save: float
    driver: float = 0.0


class LapRecord(BaseModel):
    lap: int
    lap_time_s: float
    compound: Compound
    wear_end: float
    fuel_end_kg: float
    wetness: float
    safety_car: bool
    pitted: bool
    pit_loss_s: float
    new_compound: Optional[Compound] = None
    components: LapComponents


class Stint(BaseModel):
    compound: Compound
    start_lap: int
    end_lap: Optional[int] = None


class CarState(BaseModel):
    fuel_kg: float
    fuel_initial_kg: float
    fuel_status: Literal["OK", "LOW", "CRITICAL"]
    fuel_projected_end_kg: float
    compound: Compound
    tyre_wear: float
    tyre_age: int
    last_lap_s: Optional[float] = None
    best_lap_s: Optional[float] = None
    pit_stops: int
    compounds_used: list[Compound]
    tyres_available: dict[str, int]


class Conditions(BaseModel):
    track_wetness: float
    rain_intensity: float
    weather: Literal["DRY", "DAMP", "WET"]
    safety_car: bool
    sc_laps_elapsed: int


class BaselineLap(BaseModel):
    lap: int
    lap_time_s: float
    compound: Compound
    pitted: bool
    pit_loss_s: float = 0.0


class BaselineShadow(BaseModel):
    elapsed_s: float
    compound: Compound
    tyre_wear: float
    pit_stops: int
    gap_s: float
    laps: list[BaselineLap]
    stints: list[Stint]


class CarLap(BaseModel):
    lap: int
    lap_time_s: float
    elapsed_s: float
    pitted: bool
    pit_loss_s: float
    compound: Compound
    safety_car: bool


class CarSummary(BaseModel):
    id: str
    code: str
    name: str
    color: str
    is_primary: bool
    simulated: bool
    grid_slot: int
    pace_offset_s: float
    laps: list[CarLap]
    elapsed_s: float
    compound: Compound
    tyre_wear: float
    tyre_age: int
    fuel_kg: float
    pit_stops: int
    last_lap_s: Optional[float] = None
    position: int
    gap_to_leader_s: float


class RaceState(BaseModel):
    version: int
    status: Literal["idle", "running", "paused", "finished"]
    config_name: str
    seed: int
    lap: int
    total_laps: int
    max_wear: float
    circuit_id: str
    pit_service_ratio: float
    cars: list[CarSummary]
    elapsed_s: float
    speed: float
    replan_count: int
    car: CarState
    conditions: Conditions
    laps: list[LapRecord]
    stints: list[Stint]
    recommendation: Optional[Recommendation] = None
    events: list[RaceEvent]
    baseline: Optional[BaselineShadow] = None


# ---------------------------------------------------------------- requests
class ResetRequest(BaseModel):
    config_name: Optional[str] = None
    seed: Optional[int] = None
    total_laps: Optional[int] = Field(None, ge=5, le=80)


class SpeedRequest(BaseModel):
    speed: float = Field(..., ge=0.5, le=16)


class EventRequest(BaseModel):
    type: Literal["RAIN", "CLEAR", "SC_DEPLOY", "SC_WITHDRAW"]
    intensity: Optional[float] = Field(None, ge=0.1, le=1.0)


class EvalRequest(BaseModel):
    trials: int = Field(100, ge=1, le=500)
    seed_start: int = Field(10000, ge=0)
    scenarios: Optional[int] = Field(None, ge=2, le=40)


# ---------------------------------------------------------------- benchmark
class TrialResult(BaseModel):
    seed: int
    baseline_s: Optional[float] = None
    adaptive_s: Optional[float] = None
    saved_s: Optional[float] = None
    winner: Literal["ADAPTIVE", "BASELINE", "TIE"]
    baseline_stops: int
    adaptive_stops: int
    baseline_mean_lap_s: Optional[float] = None
    adaptive_mean_lap_s: Optional[float] = None
    replans: int
    mean_decision_ms: float
    max_decision_ms: float
    fuel_failures: int
    tyre_violations: int
    forced_pits_baseline: int
    forced_pits_adaptive: int
    invalid_plans: int
    baseline_invalid_plans: int
    baseline_tyre_violations: int
    completed: bool
    category: str
    error: Optional[str] = None


class CategoryStats(BaseModel):
    n: int
    mean_saved_s: float
    win_rate: float
    loss_rate: float


class BenchmarkSummary(BaseModel):
    trials: int
    completed: int
    failed_trials: int
    seed_start: int
    seed_set: Literal["eval", "dev"]
    scenarios: int
    baseline_mean_s: float
    adaptive_mean_s: float
    mean_saved_s: float
    median_saved_s: float
    std_saved_s: float
    ci95_saved_s: list[float]
    pct_improvement: float
    win_rate: float
    wins: int
    losses: int
    ties: int
    invalid_plans: int
    baseline_invalid_plans: int
    tyre_violations: int
    baseline_tyre_violations: int
    fuel_failures: int
    mean_decision_ms: float
    p95_decision_ms: float
    by_category: dict[str, CategoryStats]
    runtime_s: float
    created_at: str
    config_name: str


class BenchmarkResults(BaseModel):
    summary: BenchmarkSummary
    trials: list[TrialResult]


class BenchmarkStatus(BaseModel):
    state: Literal["idle", "running", "done", "error"]
    completed: int
    total: int
    error: Optional[str] = None
