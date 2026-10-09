import copy
from dataclasses import fields

import numpy as np
import pytest

from app.config import load_config
from app.events import build_schedule
from app.simulation import RaceEngine, Decision
from app.strategy import StayOutPolicy, FixedStintBaseline


class PitAt:
    def __init__(self, lap, c="HARD"):
        self.lap, self.c = lap, c

    def decide(self, snap):
        return Decision(pit=snap.lap + 1 == self.lap, compound=self.c)


def mk(cfg=None, policy=None, seed=None):
    cfg = cfg or load_config("default")
    return RaceEngine(cfg, build_schedule(cfg, seed), policy or FixedStintBaseline(cfg))


def test_race_starts_advances_finishes():
    e = mk()
    assert e.status == "idle"
    e.start()
    assert e.status == "running"
    for _ in range(25):
        e.step()
    assert e.finished and e.lap == 25 and len(e.laps) == 25
    with pytest.raises(RuntimeError):
        e.step()


def test_seed_reproducible_and_differs():
    a, b, c = mk(seed=3), mk(seed=3), mk(seed=4)
    for e in (a, b, c):
        e.run_to_end()
    assert [r.lap_time_s for r in a.laps] == [r.lap_time_s for r in b.laps]
    assert [r.lap_time_s for r in a.laps] != [r.lap_time_s for r in c.laps]


def test_pit_loss_charged_once_and_tyres_reset():
    cfg = load_config("demo")
    e = mk(cfg, PitAt(10))
    e.run_to_end()
    pits = [r for r in e.laps if r.pitted]
    assert len(pits) == 1 and pits[0].lap == 10
    assert pits[0].pit_loss_s == pytest.approx(25.0)
    assert sum(r.pit_loss_s for r in e.laps) == pytest.approx(25.0)
    assert e.pit_stops == 1
    assert e.laps[10].compound == "HARD"          # lap 11 on fresh hards
    assert e.stints[0]["end_lap"] == 10 and e.stints[1]["start_lap"] == 11


def test_fuel_monotone_never_negative():
    e = mk(load_config("demo"), StayOutPolicy())
    e.run_to_end()
    f = [r.fuel_end_kg for r in e.laps]
    assert all(x >= 0 for x in f) and f == sorted(f, reverse=True)


def test_manual_rain_and_sc():
    cfg = load_config("demo")
    e = mk(cfg, StayOutPolicy())
    for _ in range(5):
        e.step()
    assert e.wetness == 0
    e.apply_event("RAIN", 0.8)
    assert e.rain_intensity == pytest.approx(0.8) and e.wetness == pytest.approx(0.3)
    e.step()
    assert e.laps[-1].wetness == pytest.approx(0.3)
    e.apply_event("SC_DEPLOY")
    assert e.sc_active
    e.step()
    assert e.laps[-1].safety_car
    assert e.laps[-1].lap_time_s >= cfg.base_lap_s * cfg.safety_car.lap_factor - 1e-9
    e.apply_event("SC_WITHDRAW")
    assert not e.sc_active
    with pytest.raises(ValueError):
        e.apply_event("SC_WITHDRAW")


def test_same_conditions_regardless_of_policy():
    cfg = load_config("default")
    sched = build_schedule(cfg, 11)
    e1 = RaceEngine(cfg, copy.deepcopy(sched), StayOutPolicy())
    e2 = RaceEngine(cfg, copy.deepcopy(sched), PitAt(6, "HARD"))
    e1.run_to_end()
    e2.run_to_end()
    assert [(r.wetness, r.safety_car) for r in e1.laps] == [(r.wetness, r.safety_car) for r in e2.laps]


def test_snapshot_exposes_no_hidden_future():
    e = mk()
    snap = e.snapshot()
    for f in fields(snap):
        assert not isinstance(getattr(snap, f.name), np.ndarray)
    assert not hasattr(snap, "_schedule") and not hasattr(snap, "schedule")
    assert snap.laps == []


def test_wear_limit_safety_net_forces_pit():
    cfg = load_config("demo")
    e = mk(cfg, StayOutPolicy())
    e.run_to_end()
    assert e.forced_pits >= 1
    assert e.tyre_violations == 0


def test_rival_cars_share_weather_but_not_noise_and_apply_pace_offset():
    from app.events import car_variant
    from app.strategy import CompetitorPolicy
    cfg = load_config("demo")
    base = build_schedule(cfg)
    v1, v1b, v2 = car_variant(base, cfg, 1), car_variant(base, cfg, 1), car_variant(base, cfg, 2)
    assert (v1.noise == v1b.noise).all() and not (v1.noise == v2.noise).all()   # deterministic per car
    assert not (v1.noise == base.noise).all()
    e0 = RaceEngine(cfg, base, StayOutPolicy())
    e1 = RaceEngine(cfg, v1, CompetitorPolicy(cfg, 10, "HARD", 0.5), pace_offset_s=0.4)
    for e in (e0, e1):
        e.step()
        e.step()
        e.apply_event("RAIN", 0.8)            # same manual event -> same hidden weather change
        e.apply_event("SC_DEPLOY")
        for _ in range(3):
            e.step()
    assert [(r.wetness, r.safety_car) for r in e0.laps] == [(r.wetness, r.safety_car) for r in e1.laps]
    assert all(r.components["driver"] == pytest.approx(0.4) for r in e1.laps)
    assert all(r.components["driver"] == 0.0 for r in e0.laps)
    assert sum(e1.laps[0].components.values()) == pytest.approx(e1.laps[0].lap_time_s)


def test_competitor_policy_switches_to_wets_and_pits_once_in_dry():
    from app.strategy import CompetitorPolicy
    cfg = load_config("demo")
    dry = RaceEngine(cfg, build_schedule(cfg), CompetitorPolicy(cfg, 10, "HARD", 0.5))
    dry.run_to_end()
    assert dry.pit_stops == 1 and not dry.rule_violation and dry.tyre_violations == 0
    wet = RaceEngine(cfg, build_schedule(cfg), CompetitorPolicy(cfg, 10, "HARD", 0.5))
    for _ in range(6):
        wet.step()
    wet.apply_event("RAIN", 0.9)
    wet.run_to_end()
    assert "WET" in wet.compounds_used
