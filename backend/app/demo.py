"""Headless demo: python -m app.demo [--config demo]

Dry race -> manual heavy rain at lap 8 -> manual safety car at lap 13 -> finish, versus a
shadow fixed-stint baseline that experiences the same events.
"""
from __future__ import annotations

import argparse
import copy

from .config import load_config
from .events import build_schedule
from .simulation import RaceEngine
from .strategy import AdaptivePolicy, FixedStintBaseline


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="demo")
    ap.add_argument("--rain-lap", type=int, default=8)
    ap.add_argument("--sc-lap", type=int, default=13)
    args = ap.parse_args()
    cfg = load_config(args.config)
    sched = build_schedule(cfg)
    pol = AdaptivePolicy(cfg)
    a = RaceEngine(cfg, sched, pol)
    b = RaceEngine(cfg, copy.deepcopy(sched), FixedStintBaseline(cfg))
    scripted = args.config == "demo_scripted"
    pol.observe(a.snapshot())
    for typ, msg in pol.drain_events():
        a.log(typ, msg)
    shown = 0

    def flush():
        nonlocal shown
        for ev in a.events[shown:]:
            if ev["type"] in ("STRATEGY_RECALCULATED", "RECOMMENDATION_CHANGED", "PIT_STOP", "FORCED_PIT",
                              "MANUAL_EVENT", "WARNING"):
                print(f"   [L{ev['lap']:02d} {ev['type']}] {ev['message']}")
        shown = len(a.events)

    flush()
    print(f"{'lap':>3} {'cmp':<6} {'wear':>5} {'fuel':>5} {'wet':>4} {'SC':>2} {'lap s':>7}  baseline")
    while not a.finished:
        if not scripted and a.lap == args.rain_lap:
            a.apply_event("RAIN", 0.8); b.apply_event("RAIN", 0.8)
            pol.observe(a.snapshot())
            for typ, msg in pol.drain_events():
                a.log(typ, msg)
        if not scripted and a.lap == args.sc_lap and not a.sc_active:
            a.apply_event("SC_DEPLOY"); b.apply_event("SC_DEPLOY")
            pol.observe(a.snapshot())
            for typ, msg in pol.drain_events():
                a.log(typ, msg)
        flush()
        ra, rb = a.step(), b.step()
        print(f"{ra.lap:>3} {ra.compound:<6} {ra.wear_end:5.2f} {ra.fuel_end_kg:5.1f} {ra.wetness:4.2f} "
              f"{'SC' if ra.safety_car else '  '} {ra.lap_time_s:7.2f}  {rb.compound:<6}{rb.lap_time_s:7.2f}"
              f"{'  <PIT' if ra.pitted else ''}{'  (base PIT)' if rb.pitted else ''}")
    flush()
    print(f"\nadaptive {a.elapsed_s:.1f}s  stints {[(s['compound'], s['start_lap'], s['end_lap']) for s in a.stints]}")
    print(f"baseline {b.elapsed_s:.1f}s  stints {[(s['compound'], s['start_lap'], s['end_lap']) for s in b.stints]}")
    print(f"gap (baseline - adaptive): {b.elapsed_s - a.elapsed_s:+.1f}s; replans {pol.replan_count}")


if __name__ == "__main__":
    main()
