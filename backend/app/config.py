"""Race configuration models. All defaults live here; JSON files in /configs override them."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Literal, Optional

from pydantic import BaseModel, Field, model_validator

Compound = Literal["SOFT", "MEDIUM", "HARD", "WET"]
DRY_COMPOUNDS: tuple[str, ...] = ("SOFT", "MEDIUM", "HARD")
ALL_COMPOUNDS: tuple[str, ...] = ("SOFT", "MEDIUM", "HARD", "WET")

CONFIG_DIR = Path(__file__).resolve().parents[2] / "configs"
RESULTS_DIR = Path(__file__).resolve().parents[2] / "results"


class FuelCfg(BaseModel):
    initial_kg: float = 50.0
    burn_kg_per_lap: float = 1.9
    sc_burn_factor: float = 0.5
    sensitivity_s_per_kg: float = 0.035
    reserve_kg: float = 1.0
    fuel_save_penalty_s_per_kg: float = 1.5


class TyreCfg(BaseModel):
    pace_offset_s: float
    wear_rate: float
    a: float
    b: float


def _default_tyres() -> dict[str, TyreCfg]:
    return {
        "SOFT": TyreCfg(pace_offset_s=0.0, wear_rate=0.070, a=2.0, b=6.0),
        "MEDIUM": TyreCfg(pace_offset_s=0.6, wear_rate=0.040, a=1.8, b=5.0),
        "HARD": TyreCfg(pace_offset_s=1.1, wear_rate=0.025, a=1.6, b=4.5),
        "WET": TyreCfg(pace_offset_s=0.0, wear_rate=0.030, a=1.5, b=4.0),
    }


class WeatherCfg(BaseModel):
    general_wet_slowdown_s: float = 5.0
    slick_wet_penalty_s: float = 12.0
    wet_tyre_dry_penalty_s: float = 5.0
    wetting_rate: float = 0.30
    drying_rate: float = 0.08
    wet_tyre_wear_dry_mult: float = 2.0


class SafetyCarCfg(BaseModel):
    lap_factor: float = 1.40
    pit_loss_factor: float = 0.45
    wear_factor: float = 0.3


class PitCfg(BaseModel):
    service_s: float = 20.0
    transit_s: float = 5.0


class NoiseCfg(BaseModel):
    lap_sigma_s: float = 0.15
    traffic_prob: float = 0.12
    traffic_min_s: float = 0.2
    traffic_max_s: float = 1.0


class DegradationCfg(BaseModel):
    race_mult_sigma: float = 0.08
    race_mult_min: float = 0.85
    race_mult_max: float = 1.20
    per_lap_sigma: float = 0.03


class EventModelCfg(BaseModel):
    p_rain_start_per_lap: float = 0.03
    rain_stop_prob_per_lap: float = 0.12
    rain_intensity_min: float = 0.3
    rain_intensity_max: float = 0.9
    p_sc_per_lap: float = 0.025
    sc_duration_min: int = 2
    sc_duration_max: int = 4


class OptimizerCfg(BaseModel):
    scenarios_live: int = 16
    scenarios_benchmark: int = 10
    hysteresis_s: float = 0.3
    cvar_lambda: float = 0.0
    infeasible_tolerance: float = 0.1   # share of sampled futures allowed to hit the wear limit (with recourse penalty)
    beam_width: int = 30
    degradation_replan_threshold: float = 0.08
    wetness_replan_threshold: float = 0.15


class BaselineCfg(BaseModel):
    pit_laps: list[int] = Field(default_factory=lambda: [12])
    dry_compounds: list[str] = Field(default_factory=lambda: ["HARD"])
    wet_threshold: float = 0.3


class ScriptedEvent(BaseModel):
    lap: int
    type: Literal["RAIN", "SC"]
    intensity: float = 0.8
    duration: int = 5


class RaceConfig(BaseModel):
    name: str = "default"
    total_laps: int = Field(25, ge=3, le=200)
    base_lap_s: float = 90.0
    seed: int = 7
    start_compound: Compound = "MEDIUM"
    circuit: str = "silverstone"
    track_scaling: bool = True          # derive base lap, fuel and tyre-wear inputs from the circuit geometry (see tracks.py)
    track_applied: bool = False         # set once the circuit scaling has been applied, so it can never be applied twice
    fuel: FuelCfg = Field(default_factory=FuelCfg)
    tyres: dict[str, TyreCfg] = Field(default_factory=_default_tyres)
    max_wear: float = 0.80
    min_stint_laps: int = 2
    max_stops: int = 2
    allocation: dict[str, int] = Field(
        default_factory=lambda: {"SOFT": 2, "MEDIUM": 2, "HARD": 2, "WET": 3}
    )
    require_two_dry_compounds: bool = True
    weather: WeatherCfg = Field(default_factory=WeatherCfg)
    safety_car: SafetyCarCfg = Field(default_factory=SafetyCarCfg)
    pit: PitCfg = Field(default_factory=PitCfg)
    noise: NoiseCfg = Field(default_factory=NoiseCfg)
    degradation: DegradationCfg = Field(default_factory=DegradationCfg)
    event_model: EventModelCfg = Field(default_factory=EventModelCfg)
    random_events: bool = True
    scripted_events: list[ScriptedEvent] = Field(default_factory=list)
    optimizer: OptimizerCfg = Field(default_factory=OptimizerCfg)
    baseline: BaselineCfg = Field(default_factory=BaselineCfg)

    @model_validator(mode="after")
    def _apply_track(self) -> "RaceConfig":
        if self.track_scaling and not self.track_applied:
            from . import tracks          # local import: tracks reads circuit files and has no dependency on this module
            tracks.apply_to_config(self)
            self.track_applied = True
        return self


def list_configs() -> list[str]:
    return sorted(p.stem for p in CONFIG_DIR.glob("*.json"))


def load_config(name: str = "default", **overrides) -> RaceConfig:
    """Load configs/<name>.json on top of the defaults (default.json is the base for all)."""
    path = CONFIG_DIR / f"{name}.json"
    if not path.exists():
        raise FileNotFoundError(f"unknown config '{name}'")
    data: dict = {}
    base = CONFIG_DIR / "default.json"
    if name != "default" and base.exists():
        data.update(json.loads(base.read_text(encoding="utf-8")))
    data.update(json.loads(path.read_text(encoding="utf-8")))
    for k, v in overrides.items():
        if v is not None:
            data[k] = v
    return RaceConfig(**data)
