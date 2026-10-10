"""Does the strategy actually win races? A full-field experiment.

For each seed the SAME hidden world (weather, safety car, lap noise streams) is raced twice against the SAME seven rule-based
rivals (the ones in the live game): once with the strategy car driven by the adaptive optimizer, once by the fixed-stint
baseline. We count how often each strategy finishes first (and on the podium) and the mean finishing position.

The strategy car's own pace relative to the field is a parameter (negative = faster). A strategy cannot make a slow car win a dry race
on pure pace, so the report is shown for a front-running car (equal machinery, strategy decides) and for the mid-field car of the
default game, and says so. Nothing here changes the simulation model: it only runs the existing engines side by side.

    python -m app.victory --trials 40 --circuit silverstone
"""
from __future__ import annotations

import argparse
import copy
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import numpy as np

from .config import RESULTS_DIR, RaceConfig, ScriptedEvent, load_config
from .events import build_schedule, car_variant
from .simulation import RaceEngine
from .strategy import AdaptivePolicy, CompetitorPolicy, FixedStintBaseline

RIVAL_SPECS = [  # same field as the live session (app/session.py RIVALS)
    ("AXL", -0.45, "MEDIUM", 11, "HARD", 0.55), ("BRV", -0.25, "SOFT", 8, "HARD", 0.45), ("CRS", -0.10, "MEDIUM", 12, "HARD", 0.65),
    ("DLT", 0.05, "SOFT", 9, "MEDIUM", 0.50), ("EMB", 0.20, "MEDIUM", 10, "HARD", 0.60), ("FRG", 0.40, "MEDIUM", 13, "HARD", 0.70),
    ("GLC", 0.65, "SOFT", 8, "MEDIUM", 0.55),
]

SCENARIOS: dict[str, list[ScriptedEvent]] = {
    "dry": [],
    "rain": [ScriptedEvent(lap=8, type="RAIN", intensity=0.8, duration=7)],
    "safety_car": [ScriptedEvent(lap=10, type="SC", duration=3)],
    "rain_and_sc": [ScriptedEvent(lap=8, type="RAIN", intensity=0.8, duration=7), ScriptedEvent(lap=14, type="SC", duration=3)],
}


@dataclass
class FieldResult:
    position: int
    winner: str
    primary_s: float
    gap_to_winner_s: float


def run_field(cfg: RaceConfig, seed: int, strategy: str, pace: float, M: int = 10) -> FieldResult:
    sched = build_schedule(cfg, seed)
    if strategy == "adaptive":
        primary = RaceEngine(cfg, copy.deepcopy(sched), AdaptivePolicy(cfg, M=M, seed=seed), pace_offset_s=pace)
    else:
        primary = RaceEngine(cfg, copy.deepcopy(sched), FixedStintBaseline(cfg), pace_offset_s=pace)
    engines = {"YOU": primary}
    for i, (code, rp, start, pit_lap, pit_to, wet) in enumerate(RIVAL_SPECS, start=1):
        rcfg = cfg.model_copy(update={"start_compound": start})
        engines[code] = RaceEngine(rcfg, car_variant(sched, cfg, i), CompetitorPolicy(rcfg, pit_lap, pit_to, wet), pace_offset_s=rp)
    for e in engines.values():
        e.run_to_end()
    order = sorted(engines, key=lambda k: engines[k].elapsed_s)
    return FieldResult(position=order.index("YOU") + 1, winner=order[0], primary_s=primary.elapsed_s,
                       gap_to_winner_s=primary.elapsed_s - engines[order[0]].elapsed_s)


def _summ(rs: list[FieldResult]) -> dict:
    pos = np.array([r.position for r in rs])
    return {"win_rate": float((pos == 1).mean()), "podium_rate": float((pos <= 3).mean()), "mean_position": float(pos.mean()),
            "wins": int((pos == 1).sum()), "trials": len(rs)}


def experiment(circuit: str = "silverstone", trials: int = 40, seed_start: int = 20000, paces: tuple[float, ...] = (-0.55, 0.0),
               scenarios: Optional[list[str]] = None, M: int = 10, progress=None) -> dict:
    out: dict = {"circuit_id": circuit, "trials": trials, "seed_start": seed_start, "optimizer_scenarios": M, "paces": {}, "note": (
        "Same hidden world and same rivals for both strategies per seed. pace is the strategy car's pace offset vs the field "
        "(negative = faster; the fastest rival is -0.45). Results are simulated, not real-world.")}
    for pace in paces:
        block = {}
        for name in (scenarios or list(SCENARIOS)):
            cfg = load_config("default", circuit=circuit, random_events=False, scripted_events=SCENARIOS[name])
            ad, bs = [], []
            for k in range(trials):
                ad.append(run_field(cfg, seed_start + k, "adaptive", pace, M))
                bs.append(run_field(cfg, seed_start + k, "baseline", pace, M))
                if progress:
                    progress(pace, name, k + 1, trials)
            a, b = _summ(ad), _summ(bs)
            block[name] = {"adaptive": a, "baseline": b, "win_rate_gain": a["win_rate"] - b["win_rate"],
                           "mean_position_gain": b["mean_position"] - a["mean_position"],
                           "mean_time_saved_s": float(np.mean([y.primary_s - x.primary_s for x, y in zip(ad, bs)]))}
        out["paces"][f"{pace:+.2f}"] = block
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--trials", type=int, default=40)
    ap.add_argument("--circuit", default="silverstone")
    ap.add_argument("--seed-start", type=int, default=20000)
    ap.add_argument("--out", default=str(RESULTS_DIR))
    args = ap.parse_args()
    res = experiment(args.circuit, args.trials, args.seed_start,
                     progress=lambda p, s, k, n: print(f"pace {p:+.2f} {s}: {k}/{n}", flush=True) if k == n else None)
    Path(args.out).mkdir(parents=True, exist_ok=True)
    path = Path(args.out) / f"victory_{args.circuit}.json"
    path.write_text(json.dumps(res, indent=2), encoding="utf-8")
    for pace, block in res["paces"].items():
        print(f"\nstrategy-car pace {pace} s vs field")
        for name, r in block.items():
            a, b = r["adaptive"], r["baseline"]
            print(f"  {name:12s} WIN adaptive {a['win_rate']:5.0%} vs fixed {b['win_rate']:5.0%} | podium {a['podium_rate']:4.0%} vs {b['podium_rate']:4.0%} "
                  f"| mean pos {a['mean_position']:.2f} vs {b['mean_position']:.2f} | time saved {r['mean_time_saved_s']:+.1f}s")
    print(f"\nwrote {path}")


if __name__ == "__main__":
    main()
