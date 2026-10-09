"""RaceEngine: deterministic lap-by-lap race simulation. Pure Python, no web dependencies.

Policies only ever see a RaceSnapshot (public, observed state). The hidden WorldSchedule is
private to the engine.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional, Protocol

from .config import RaceConfig, DRY_COMPOUNDS, ALL_COMPOUNDS
from .events import WorldSchedule, apply_manual_event
from .physics import (LapInputs, lap_time, fuel_burn, pit_loss, next_wetness, next_wear,
                      wear_increment, weather_label)


@dataclass
class LapRecord:
    lap: int
    lap_time_s: float
    compound: str
    wear_end: float
    fuel_end_kg: float
    wetness: float
    safety_car: bool
    pitted: bool
    pit_loss_s: float
    new_compound: Optional[str]
    components: dict


@dataclass
class Decision:
    pit: bool = False
    compound: Optional[str] = None
    events: list = field(default_factory=list)   # (type, message) tuples to log


@dataclass
class RaceSnapshot:
    lap: int
    total_laps: int
    fuel_kg: float
    compound: str
    wear: float
    tyre_age: int
    compounds_used: tuple
    available: dict
    pit_stops: int
    elapsed_s: float
    rain_intensity: float
    track_wetness: float
    sc_active: bool
    sc_laps_elapsed: int
    laps: list
    deg_estimate: float
    cfg: RaceConfig


class Policy(Protocol):
    def decide(self, snap: RaceSnapshot) -> Decision: ...


def rule_ok(cfg: RaceConfig, used: set, extra: Optional[str] = None) -> bool:
    s = set(used) | ({extra} if extra else set())
    if not cfg.require_two_dry_compounds or "WET" in s:
        return True
    return len({c for c in s if c in DRY_COMPOUNDS}) >= 2


def pick_compound(cfg: RaceConfig, wetness: float, laps_left: int, available: dict,
                  used: set, sc_active: bool = False, deg: float = 1.0) -> Optional[str]:
    """Heuristic compound choice used for forced stops and baseline fallbacks (fuel ignored)."""
    best, best_key = None, None
    for c in ALL_COMPOUNDS:
        if available.get(c, 0) <= 0:
            continue
        w, cost = 0.0, 0.0
        for _ in range(max(1, laps_left)):
            t = lap_time(LapInputs(c, w, 0.0, wetness, False), cfg)
            cost += t.compound + t.wear + t.weather
            w = next_wear(w, wear_increment(c, wetness, False, deg, cfg))
        infeasible = w > cfg.max_wear
        key = (infeasible, not rule_ok(cfg, used, c), cost)
        if best_key is None or key < best_key:
            best, best_key = c, key
    return best


class RaceEngine:
    def __init__(self, cfg: RaceConfig, schedule: WorldSchedule, policy: Policy, pace_offset_s: float = 0.0):
        self.cfg = cfg
        self.pace_offset_s = pace_offset_s
        # policies see a config with the scripted (hidden) event list removed
        self._public_cfg = cfg.model_copy(update={"scripted_events": []})
        self.policy = policy
        self._schedule = schedule
        self.status = "idle"
        self.lap = 0
        self.elapsed_s = 0.0
        self.fuel_kg = cfg.fuel.initial_kg
        self.fuel_initial_kg = cfg.fuel.initial_kg
        self.compound = cfg.start_compound
        self.wear = 0.0
        self.tyre_age = 0
        self.pit_stops = 0
        self.available = dict(cfg.allocation)
        self.available[self.compound] = max(0, self.available[self.compound] - 1)
        self.compounds_used: list[str] = [self.compound]
        self.laps: list[LapRecord] = []
        self.stints: list[dict] = [{"compound": self.compound, "start_lap": 1, "end_lap": None}]
        self.events: list[dict] = []
        self._eid = 0
        self.best_lap_s: Optional[float] = None
        # stats
        self.tyre_violations = 0
        self.fuel_failures = 0
        self.forced_pits = 0
        self.invalid_plans = 0
        self.rule_violation = False
        # revealed conditions for the upcoming lap
        self._wet_prev = 0.0
        self.wetness = 0.0
        self.rain_intensity = 0.0
        self.sc_active = False
        self._sc_run = 0
        self._stint_obs = 0.0
        self._stint_nom = 0.0
        self._stint_n = 0
        self._reveal(initial=True)

    # ---------------------------------------------------------------- events/log
    def log(self, typ: str, msg: str) -> None:
        self._eid += 1
        self.events.append({"id": self._eid, "lap": self.lap, "type": typ,
                            "message": msg, "sim_time_s": round(self.elapsed_s, 3)})

    def _reveal(self, initial: bool = False) -> None:
        k = self.lap + 1
        if k > self.cfg.total_laps:
            return
        prev_rain, prev_sc, prev_label = self.rain_intensity, self.sc_active, weather_label(self.wetness)
        self.rain_intensity = float(self._schedule.rain[k])
        self.wetness = float(next_wetness(self._wet_prev, self.rain_intensity, self.cfg))
        self.sc_active = bool(self._schedule.sc[k])
        if initial:
            return
        if prev_rain <= 0 < self.rain_intensity:
            self.log("RAIN_STARTED", f"Rain starting (intensity {self.rain_intensity:.2f})")
        elif prev_rain > 0 >= self.rain_intensity:
            self.log("RAIN_STOPPED", "Rain has stopped")
        elif abs(prev_rain - self.rain_intensity) > 1e-9:
            self.log("RAIN_CHANGED", f"Rain intensity now {self.rain_intensity:.2f}")
        label = weather_label(self.wetness)
        if label != prev_label:
            self.log("WEATHER_CHANGED", f"Track conditions {prev_label} -> {label} (wetness {self.wetness:.2f})")
        if self.sc_active and not prev_sc:
            self.log("SC_DEPLOYED", "Safety car deployed")
        elif prev_sc and not self.sc_active:
            self.log("SC_WITHDRAWN", "Safety car in this lap - racing resumes")

    # ---------------------------------------------------------------- views
    @property
    def deg_estimate(self) -> float:
        n = self._stint_n
        if n == 0 or self._stint_nom <= 0:
            return 1.0
        obs = self._stint_obs / self._stint_nom
        return (n * obs + 3.0) / (n + 3.0)

    def snapshot(self) -> RaceSnapshot:
        return RaceSnapshot(
            lap=self.lap, total_laps=self.cfg.total_laps, fuel_kg=self.fuel_kg,
            compound=self.compound, wear=self.wear, tyre_age=self.tyre_age,
            compounds_used=tuple(self.compounds_used), available=dict(self.available),
            pit_stops=self.pit_stops, elapsed_s=self.elapsed_s,
            rain_intensity=self.rain_intensity, track_wetness=self.wetness,
            sc_active=self.sc_active, sc_laps_elapsed=self._sc_run if self.sc_active else 0,
            laps=list(self.laps), deg_estimate=self.deg_estimate, cfg=self._public_cfg)

    @property
    def finished(self) -> bool:
        return self.status == "finished"

    # ---------------------------------------------------------------- control
    def start(self) -> None:
        if self.status != "idle":
            raise RuntimeError("race already started")
        self.status = "running"
        self.log("RACE_STARTED", f"Race started - {self.cfg.total_laps} laps on {self.compound}")

    def apply_event(self, ev_type: str, intensity: Optional[float] = None) -> str:
        if self.finished:
            raise ValueError("race is finished")
        msg = apply_manual_event(self._schedule, self.lap, ev_type, intensity, self.cfg)
        self.log("MANUAL_EVENT", msg)
        self._reveal()
        return msg

    def step(self) -> LapRecord:
        if self.finished:
            raise RuntimeError("race finished")
        cfg, n = self.cfg, self.cfg.total_laps
        if self.status == "idle":
            self.start()
        k = self.lap + 1
        sc, wet = self.sc_active, self.wetness
        snap = self.snapshot()
        dec = self.policy.decide(snap)
        for typ, msg in dec.events:
            self.log(typ, msg)

        pit, new_c = False, None
        if dec.pit:
            c = dec.compound
            if k < n and c in ALL_COMPOUNDS and self.available.get(c, 0) > 0:
                pit, new_c = True, c
            else:
                self.invalid_plans += 1
                self.log("WARNING", f"Pit request rejected (lap {k}, compound {c})")

        mult = self._schedule.deg_mult * (1.0 + float(self._schedule.wear_noise[k]))
        inc = wear_increment(self.compound, wet, sc, mult, cfg)
        if not pit and k < n:
            est_next = wear_increment(self.compound, wet, sc, self.deg_estimate, cfg)
            if self.wear + inc + est_next > cfg.max_wear:
                c = pick_compound(cfg, wet, n - k, self.available, set(self.compounds_used),
                                  sc, self.deg_estimate)
                if c is not None:
                    pit, new_c = True, c
                    self.forced_pits += 1
                    self.log("FORCED_PIT", f"Tyres at wear limit - forced stop for {c}")

        burn, save_pen = fuel_burn(self.fuel_kg, n - k + 1, sc, cfg)
        if save_pen > 0:
            self.fuel_failures += 1
        lt = lap_time(LapInputs(self.compound, self.wear, self.fuel_kg, wet, sc,
                                float(self._schedule.traffic[k]), float(self._schedule.noise[k]),
                                save_pen, self.pace_offset_s), cfg)
        total = lt.total
        ploss = 0.0
        wear_end = next_wear(self.wear, inc)
        if wear_end > cfg.max_wear + 1e-9:
            self.tyre_violations += 1
        self._stint_obs += inc
        self._stint_nom += wear_increment(self.compound, wet, sc, 1.0, cfg)
        self._stint_n += 1
        used_compound = self.compound
        self.fuel_kg = max(0.0, self.fuel_kg - burn)
        fuel_end = self.fuel_kg
        if pit:
            ploss = pit_loss(sc, cfg)
            total += ploss
            self.stints[-1]["end_lap"] = k
            self.stints.append({"compound": new_c, "start_lap": k + 1, "end_lap": None})
            self.available[new_c] -= 1
            self.compounds_used.append(new_c)
            self.compound, self.wear, self.tyre_age = new_c, 0.0, 0
            self.pit_stops += 1
        else:
            self.wear = wear_end
            self.tyre_age += 1

        rec = LapRecord(lap=k, lap_time_s=total, compound=used_compound, wear_end=wear_end,
                        fuel_end_kg=fuel_end, wetness=wet, safety_car=sc, pitted=pit,
                        pit_loss_s=ploss, new_compound=new_c, components=lt.components())
        self.laps.append(rec)
        self.elapsed_s += total
        self.lap = k
        self._wet_prev = wet
        self._sc_run = self._sc_run + 1 if sc else 0
        if self.best_lap_s is None or lt.total < self.best_lap_s:
            self.best_lap_s = lt.total
        if pit:
            self.log("PIT_STOP", f"Pit stop: {used_compound} -> {new_c} (+{ploss:.1f}s)")
        if k >= n:
            self.stints[-1]["end_lap"] = n
            self.status = "finished"
            self.rule_violation = not rule_ok(cfg, set(self.compounds_used))
            if self.rule_violation:
                self.invalid_plans += 1
                self.log("WARNING", "Race ended without using two different dry compounds")
            self.log("RACE_FINISHED", f"Race finished in {self.elapsed_s:.1f}s")
        else:
            self._reveal()
        return rec

    def run_to_end(self) -> None:
        while not self.finished:
            self.step()
