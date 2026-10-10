"""Circuit catalogue and the circuit-dependent part of the simulation configuration.

The canonical circuit files are data/circuits/<id>.json (built by scripts/build_circuit.py from the TUM FTM racetrack-database).
The same files are rendered by the web app, so geometry and simulation can never disagree about which circuit is selected.

What changes with the circuit, and how (everything is derived from the geometry, nothing is typed in per circuit):

* base lap time   - an estimate from a curvature-limited speed profile (grip-limited corner speed, finite braking and
                    acceleration). It is a *relative* estimate: it is calibrated so that Silverstone keeps the project's
                    existing 90 s base lap, and every other circuit is scaled by the ratio of the estimated lap times.
                    It does not claim to reproduce real lap times.
* fuel            - burn per lap and the starting load scale with lap length, so the fuel margin stays comparable.
* tyre wear       - scales with lap length and with how hard the lap loads the tyres laterally (mean v^2*|curvature|).
* pit lane loss   - the lane has the same synthetic construction everywhere (not surveyed), but its time loss depends on how
                    fast the circuit is: loss ~ lane_length * (1/pit_limit - 1/mean_lap_speed), calibrated to the existing
                    5 s at Silverstone.

Fuel and tyre *models* (formulae, noise, weather, safety car) are unchanged; only their inputs are circuit-dependent.
Elevation is not in the source data, so every circuit is simulated flat; this is stated in each circuit's `limitations`.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Optional

import numpy as np
from pydantic import BaseModel

DATA_DIR = Path(__file__).resolve().parents[2] / "data" / "circuits"
REF_ID = "silverstone"           # the calibration circuit: its derived factors are exactly 1.0

# speed-profile constants (shared with the web renderer's visual profile in frontend/src/lib/speedProfile.ts)
A_LAT, A_BRAKE, A_ACCEL, V_MIN, V_MAX = 36.0, 42.0, 13.0, 21.0, 90.0
PIT_LIMIT_MS = 80.0 / 3.6


class TrackSim(BaseModel):
    """Circuit-derived inputs to the unchanged simulation model."""
    est_lap_s: float             # raw speed-profile lap-time estimate (relative; see module docstring)
    lap_time_factor: float       # est_lap_s / reference circuit's est_lap_s
    length_factor: float
    wear_factor: float
    pit_transit_factor: float
    mean_speed_ms: float
    peak_over_mean_speed: float
    cornering_load: float


class TrackInfo(BaseModel):
    id: str
    name: str
    country: str
    location: str
    description: str
    length_m: float
    official_length_m: Optional[float] = None
    official_turns: Optional[int] = None
    corners_detected: int
    clockwise: bool
    pit_lane_length_m: float
    pit_approximate: bool
    sectors_approximate: bool
    elevation_available: bool = False
    base_lap_s: float            # default-config base lap for this circuit (what a race started here uses)
    fuel_burn_kg_per_lap: float
    source: dict
    limitations: list[str]
    sim: TrackSim


class TrackSummary(BaseModel):
    """What the live state carries about the selected circuit (the full TrackInfo is at /api/circuits)."""
    id: str
    name: str
    country: str
    length_m: float
    base_lap_s: float
    fuel_burn_kg_per_lap: float
    fuel_initial_kg: float
    pit_transit_s: float
    tyre_wear_factor: float
    scaled: bool


def _raw(cid: str) -> dict:
    path = DATA_DIR / f"{cid}.json"
    if not path.exists():
        raise FileNotFoundError(f"unknown circuit '{cid}'")
    return json.loads(path.read_text(encoding="utf-8"))


def circuit_ids() -> list[str]:
    ids = sorted(p.stem for p in DATA_DIR.glob("*.json"))
    return [REF_ID] + [i for i in ids if i != REF_ID] if REF_ID in ids else ids


def _profile(d: dict) -> tuple[float, float, float, float]:
    """(estimated lap seconds, mean speed, peak/mean speed, mean lateral load) from the circuit geometry."""
    pts = np.array(d["points"], dtype=float)
    n = len(pts)
    ds = float(d["length_m"]) / n
    t = np.roll(pts, -1, axis=0) - np.roll(pts, 1, axis=0)
    t /= np.maximum(np.linalg.norm(t, axis=1, keepdims=True), 1e-9)
    j = np.roll(np.arange(n), -2)
    kappa = (t[:, 0] * t[j, 1] - t[:, 1] * t[j, 0]) / (2.0 * ds)
    k = np.abs(kappa)
    ker = np.ones(7) / 7.0
    ks = np.convolve(np.concatenate([k[-3:], k, k[:3]]), ker, mode="valid")
    v = np.clip(np.sqrt(A_LAT / np.maximum(ks, 1e-5)), V_MIN, V_MAX)
    for _ in range(3):
        for i in range(2 * n - 1, -1, -1):                       # braking (backwards around the loop)
            a, b = i % n, (i + 1) % n
            v[a] = min(v[a], float(np.sqrt(v[b] * v[b] + 2 * A_BRAKE * ds)))
        for i in range(2 * n):                                   # acceleration
            a, b = i % n, (i + 1) % n
            v[b] = min(v[b], float(np.sqrt(v[a] * v[a] + 2 * A_ACCEL * ds)))
    vn = np.roll(v, -1)
    lap = float(np.sum(ds / (0.5 * (v + vn))))
    mean_v = float(d["length_m"]) / lap
    load = float(np.mean(v * v * ks))
    return lap, mean_v, float(v.max() / mean_v), load


@lru_cache(maxsize=None)
def _ref() -> tuple[float, float, float, float]:
    return _profile(_raw(REF_ID))


@lru_cache(maxsize=None)
def track_info(cid: str) -> TrackInfo:
    d = _raw(cid)
    lap, mean_v, peak, load = _profile(d)
    r_lap, r_mean_v, _, r_load = _ref()
    r_len = float(_raw(REF_ID)["length_m"])
    length_factor = float(d["length_m"]) / r_len
    wear = float(np.clip(length_factor * (0.6 + 0.4 * load / r_load), 0.6, 1.6))
    lane = float(d["pit_lane"].get("length_m", d["pit_lane"]["entry_distance_m"] + d["pit_lane"]["exit_distance_m"]))
    r_lane = float(_raw(REF_ID)["pit_lane"].get("length_m", 370.0))
    loss = lane * (1.0 / PIT_LIMIT_MS - 1.0 / mean_v)
    r_loss = r_lane * (1.0 / PIT_LIMIT_MS - 1.0 / r_mean_v)
    pit = loss / r_loss
    ref = d["official_reference"] if "official_reference" in d else {}
    from .config import FuelCfg, RaceConfig          # defaults only; imported here because config imports this module
    default_base = RaceConfig.model_fields["base_lap_s"].default
    lf = lap / r_lap if cid != REF_ID else 1.0
    kf = length_factor if cid != REF_ID else 1.0
    return TrackInfo(
        id=cid, name=d["name"], country=d.get("country", ""), location=d.get("location", ""), description=d.get("description", ""),
        length_m=float(d["length_m"]), official_length_m=ref.get("length_m"), official_turns=ref.get("turns"),
        corners_detected=len(d["corners"]), clockwise=bool(d["clockwise"]), pit_lane_length_m=lane,
        base_lap_s=round(default_base * lf, 3), fuel_burn_kg_per_lap=round(FuelCfg().burn_kg_per_lap * kf, 4),
        pit_approximate=bool(d["pit_lane"].get("approximate", True)), sectors_approximate=bool(d["sectors"].get("approximate", True)),
        source=d["source"], limitations=d.get("limitations", []),
        sim=TrackSim(est_lap_s=round(lap, 3), lap_time_factor=lap / r_lap if cid != REF_ID else 1.0,
                     length_factor=length_factor if cid != REF_ID else 1.0, wear_factor=wear if cid != REF_ID else 1.0,
                     pit_transit_factor=pit if cid != REF_ID else 1.0, mean_speed_ms=round(mean_v, 2),
                     peak_over_mean_speed=round(peak, 3), cornering_load=round(load, 3)),
    )


def apply_to_config(cfg) -> None:
    """Scale the circuit-dependent inputs of a RaceConfig in place (once). The reference circuit is left untouched."""
    t = track_info(cfg.circuit).sim
    cfg.base_lap_s = round(cfg.base_lap_s * t.lap_time_factor, 4)
    cfg.fuel.initial_kg = round(cfg.fuel.initial_kg * t.length_factor, 4)
    cfg.fuel.burn_kg_per_lap = round(cfg.fuel.burn_kg_per_lap * t.length_factor, 5)
    for tyre in cfg.tyres.values():
        tyre.wear_rate = round(tyre.wear_rate * t.wear_factor, 6)
    cfg.pit.transit_s = round(cfg.pit.transit_s * t.pit_transit_factor, 4)


def summary(cfg) -> TrackSummary:
    info = track_info(cfg.circuit)
    return TrackSummary(id=info.id, name=info.name, country=info.country, length_m=info.length_m, base_lap_s=cfg.base_lap_s,
                        fuel_burn_kg_per_lap=cfg.fuel.burn_kg_per_lap, fuel_initial_kg=cfg.fuel.initial_kg,
                        pit_transit_s=cfg.pit.transit_s, tyre_wear_factor=info.sim.wear_factor, scaled=cfg.track_scaling)
