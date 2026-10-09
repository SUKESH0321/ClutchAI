import inspect
import time

import numpy as np
import pytest

from app import scenarios
from app.config import load_config
from app.events import build_schedule
from app.optimizer import build_tables, enumerate_plans, optimize, plan_vec, simulate_plan
from app.scenarios import sample_scenarios
from app.simulation import Decision, RaceEngine
from app.strategy import AdaptivePolicy, StayOutPolicy


class PitAt:
    def __init__(self, lap, c="HARD"):
        self.lap, self.c = lap, c

    def decide(self, snap):
        return Decision(pit=snap.lap + 1 == self.lap, compound=self.c)


def engine(cfg_name="demo", policy=None, **over):
    cfg = load_config(cfg_name, **over)
    return RaceEngine(cfg, build_schedule(cfg), policy or StayOutPolicy())


def reco_at(e, M=16, seed=1, plan=None, trig="TEST"):
    return optimize(e.snapshot(), M, seed, current_plan=plan, trigger=trig)


def test_valid_recommendation_at_start_and_one_stop():
    e = engine()
    r = reco_at(e)
    assert r.scenarios == 16 and r.candidates_feasible > 0
    assert len(r.plan) == 1
    assert 8 <= r.plan[0]["lap"] <= 14
    assert r.plan[0]["compound"] in ("HARD", "SOFT")
    tb = build_tables(e.snapshot(), sample_scenarios(e.snapshot(), 16, 1))
    v, why = plan_vec(tb, [(s["lap"], s["compound"]) for s in r.plan])
    assert v is not None, why
    rows, _ = simulate_plan(tb, [(s["lap"], s["compound"]) for s in r.plan])
    assert max(x["wear"] for x in rows) <= e.cfg.max_wear + 1e-9
    assert r.projected_finish_s == pytest.approx(e.snapshot().elapsed_s + v.mean())
    assert r.explanation and r.time_advantage_s >= 0


def test_infeasible_plans_rejected():
    e = engine()
    snap = e.snapshot()
    tb = build_tables(snap, sample_scenarios(snap, 8, 1))
    v, why = plan_vec(tb, [(5, "SOFT")])           # 20-lap soft stint
    assert v is None and why == "tyre limit"
    v, why = plan_vec(tb, [])                      # zero stops breaks two-compound rule
    assert v is None
    v, why = plan_vec(tb, [(10, "MEDIUM"), (20, "MEDIUM")])   # only 1 medium set left
    assert v is None and why == "compound unavailable"
    cands, stats = enumerate_plans(tb)
    for c in cands:
        rows, _ = simulate_plan(tb, list(c.stops))
        assert max(r["wear"] for r in rows) <= e.cfg.max_wear + 1e-9
        comps = [c0 for _, c0 in c.stops]
        assert comps.count("MEDIUM") <= 1 and comps.count("SOFT") <= 2


def test_table_cost_matches_independent_simulation_and_includes_pit_loss():
    e = engine()
    snap = e.snapshot()
    tb = build_tables(snap, sample_scenarios(snap, 8, 3))
    plan = [(10, "HARD")]
    v, _ = plan_vec(tb, plan)
    rows, total = simulate_plan(tb, plan, 0)
    assert v[0] == pytest.approx(total)
    assert total == pytest.approx(sum(r["lap_time_s"] for r in rows) + tb.P[10, 0])
    assert tb.P[10, 0] == pytest.approx(25.0) or tb.P[10, 0] < 25.0


def test_rain_triggers_wet_tyres_soon():
    e = engine()
    for _ in range(8):
        e.step()
    e.apply_event("RAIN", 0.8)
    r = reco_at(e)
    k0 = e.lap + 1
    assert r.plan[0]["compound"] == "WET"
    assert r.plan[0]["lap"] <= k0 + 1
    assert "wetness" in r.explanation.lower()


def test_safety_car_cheaper_stop_is_taken_when_stop_planned_soon():
    e = engine()
    for _ in range(8):
        e.step()
    r_before = reco_at(e)
    e.apply_event("SC_DEPLOY")
    r = reco_at(e)
    k0 = e.lap + 1
    # the stop moves inside the cheap safety-car window (this lap or the next, both under SC)
    assert r.plan[0]["lap"] <= k0 + 1
    assert r.plan[0]["lap"] <= r_before.plan[0]["lap"]
    assert "safety car" in r.explanation.lower()


def test_safety_car_late_after_stop_does_not_force_stop():
    e = engine(policy=PitAt(10))
    for _ in range(21):
        e.step()
    e.apply_event("SC_DEPLOY")
    r = reco_at(e)
    assert r.action == "STAY_OUT"


def test_does_not_see_hidden_future():
    a = load_config("demo")
    b = load_config("demo", scripted_events=[{"lap": 5, "type": "RAIN", "intensity": 0.9, "duration": 10},
                                              {"lap": 6, "type": "SC", "duration": 3}])
    ea = RaceEngine(a, build_schedule(a), StayOutPolicy())
    eb = RaceEngine(b, build_schedule(b), StayOutPolicy())
    for _ in range(2):
        ea.step()
        eb.step()
    ra, rb = reco_at(ea, seed=9), reco_at(eb, seed=9)
    assert ra.plan == rb.plan and ra.projected_finish_s == rb.projected_finish_s
    src = inspect.getsource(scenarios)
    import_lines = [l for l in src.splitlines() if l.startswith(("import ", "from "))]
    assert not any("events" in l or "WorldSchedule" in l for l in import_lines)
    assert not hasattr(scenarios, "WorldSchedule")


def test_deterministic_and_fast():
    e = engine()
    t = time.perf_counter()
    r1 = reco_at(e, seed=5)
    dt = time.perf_counter() - t
    r2 = reco_at(e, seed=5)
    assert r1.plan == r2.plan and r1.projected_finish_s == r2.projected_finish_s
    assert dt < 1.0


def test_adaptive_policy_replans_only_on_triggers():
    cfg = load_config("demo")
    pol = AdaptivePolicy(cfg)
    e = RaceEngine(cfg, build_schedule(cfg), pol)
    e.run_to_end()
    assert e.finished and e.tyre_violations == 0 and not e.rule_violation
    assert e.pit_stops == 1
    assert 2 <= pol.replan_count <= 6
    triggers = {ev["message"].split("(")[1].split(")")[0] for ev in e.events if ev["type"] == "STRATEGY_RECALCULATED"}
    assert "RACE_START" in triggers


def test_adaptive_replans_on_rain_and_sc_events():
    cfg = load_config("demo")
    pol = AdaptivePolicy(cfg)
    e = RaceEngine(cfg, build_schedule(cfg), pol)
    for _ in range(7):
        e.step()
    n0 = pol.replan_count
    e.apply_event("RAIN", 0.8)
    pol.observe(e.snapshot())
    assert pol.replan_count == n0 + 1 and pol.last_trigger == "WEATHER_CHANGE"
    e.step()
    e.apply_event("SC_DEPLOY")
    pol.observe(e.snapshot())
    assert pol.last_trigger == "SC_DEPLOYED"
    e.run_to_end()
    assert e.finished and "WET" in e.compounds_used
