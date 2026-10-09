import pytest

from app.config import load_config
from app.physics import (LapInputs, fuel_burn, lap_time, next_wear, next_wetness,
                         pit_loss, wear_increment, weather_label)

cfg = load_config("default")


def li(**kw):
    d = dict(compound="MEDIUM", wear_start=0.0, fuel_start_kg=30.0, wetness=0.0, sc_active=False)
    d.update(kw)
    return LapInputs(**d)


def test_fuel_decreases_by_burn():
    burn, pen = fuel_burn(50.0, 25, False, cfg)
    assert burn == pytest.approx(cfg.fuel.burn_kg_per_lap)
    assert pen == 0.0


def test_fuel_never_negative():
    fuel = 0.7
    for remaining in range(5, 0, -1):
        burn, _ = fuel_burn(fuel, remaining, False, cfg)
        fuel -= burn
        assert fuel >= -1e-12
    assert fuel >= 0
    burn, _ = fuel_burn(0.0, 3, False, cfg)
    assert burn == 0.0


def test_fuel_save_penalty_when_short():
    burn, pen = fuel_burn(10.0, 10, False, cfg)
    assert burn < cfg.fuel.burn_kg_per_lap and pen > 0


def test_more_fuel_never_faster():
    times = [lap_time(li(fuel_start_kg=f), cfg).total for f in (0, 10, 20, 40, 50)]
    assert times == sorted(times)


def test_wear_bounds_and_ordering():
    assert next_wear(0.95, 0.2) == 1.0
    s = wear_increment("SOFT", 0, False, 1.0, cfg)
    h = wear_increment("HARD", 0, False, 1.0, cfg)
    assert s > h > 0


def test_worn_tyres_slower():
    fresh = lap_time(li(wear_start=0.0), cfg).total
    worn = lap_time(li(wear_start=0.6), cfg).total
    assert worn > fresh


def test_wet_vs_slick_suitability():
    assert lap_time(li(compound="WET", wetness=0.7), cfg).total < lap_time(li(compound="MEDIUM", wetness=0.7), cfg).total
    assert lap_time(li(compound="MEDIUM", wetness=0.0), cfg).total < lap_time(li(compound="WET", wetness=0.0), cfg).total


def test_safety_car_pace_and_no_double_count():
    t = lap_time(li(sc_active=True), cfg)
    assert t.total == pytest.approx(cfg.base_lap_s * cfg.safety_car.lap_factor)
    assert t.event > 0
    parts = sum(t.components().values())
    assert parts == pytest.approx(t.total)


def test_pit_loss_once_and_sc_discount():
    assert pit_loss(False, cfg) == pytest.approx(25.0)
    assert pit_loss(True, cfg) == pytest.approx(25.0 * 0.45)


def test_wetness_dynamics_and_label():
    w = next_wetness(0.0, 0.8, cfg)
    assert w == pytest.approx(0.30)
    assert next_wetness(0.5, 0.0, cfg) == pytest.approx(0.42)
    assert next_wetness(0.0, 0.0, cfg) == 0.0
    assert weather_label(0.1) == "DRY" and weather_label(0.3) == "DAMP" and weather_label(0.6) == "WET"


def test_medium_stint_sanity():
    # 11 fresh laps on MEDIUM, pace offset + wear only (hand-checked ~13.6 s)
    total, w = 0.0, 0.0
    for _ in range(11):
        t = lap_time(li(wear_start=w, fuel_start_kg=0.0), cfg)
        total += t.compound + t.wear
        w = next_wear(w, wear_increment("MEDIUM", 0, False, 1.0, cfg))
    assert total == pytest.approx(13.6, abs=0.3)
