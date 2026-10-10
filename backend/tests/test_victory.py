"""The strategy-wins demos: the shipped configs load, and in the rain demos the adaptive strategy wins the race against the full field."""
import pytest

from app.config import list_configs, load_config
from app.victory import SCENARIOS, run_field

DEMOS = ["demo_win_rain", "demo_win_chaos", "demo_win_sc", "demo_win_dry", "demo_underdog_rain"]


def test_demo_configs_exist_and_load():
    names = list_configs()
    for d in DEMOS:
        assert d in names
        cfg = load_config(d)
        assert cfg.seed == 100 and cfg.random_events is False


def test_front_runner_pace_is_applied_in_the_live_session():
    from app.session import RaceSession
    import asyncio
    s = RaceSession()
    asyncio.run(s.reset("demo_win_rain", None, None))
    assert s.engine.pace_offset_s == -0.55 and s.baseline.pace_offset_s == -0.55
    prim = [c for c in s.to_state()["cars"] if c["is_primary"]][0]
    assert prim["pace_offset_s"] == -0.55


@pytest.mark.parametrize("name,scenario,pace", [("demo_win_rain", "rain", -0.55), ("demo_win_chaos", "rain_and_sc", -0.55), ("demo_underdog_rain", "rain", 0.0)])
def test_adaptive_strategy_wins_the_race_where_the_fixed_stint_strategy_does_not(name, scenario, pace):
    cfg = load_config(name)
    a = run_field(cfg, cfg.seed, "adaptive", pace)
    b = run_field(cfg, cfg.seed, "baseline", pace)
    assert a.position == 1 and a.winner == "YOU"
    assert b.position > 1 and b.primary_s - a.primary_s > 10


def test_in_a_dry_race_the_optimizer_matches_but_does_not_beat_the_baseline():
    # honest limit: with no weather or safety-car information to exploit, the fixed-stint plan is already near optimal
    cfg = load_config("demo_win_dry")
    a = run_field(cfg, cfg.seed, "adaptive", -0.55)
    b = run_field(cfg, cfg.seed, "baseline", -0.55)
    assert abs(a.primary_s - b.primary_s) < 2.0
