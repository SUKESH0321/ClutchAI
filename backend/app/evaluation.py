"""Paired benchmark: adaptive vs fixed-stint baseline on identical simulated worlds.

Each trial builds ONE hidden world (weather, safety cars, noise, traffic, degradation) from the trial
seed and runs both policies on deep copies of it. Seed sets: dev = 1..999 (tuning), eval = 10000+
(reported numbers; never tune on these).

CLI: python -m app.evaluation --trials 100 --seed-start 10000 --scenarios 10 --out ../results
"""
from __future__ import annotations

import argparse
import copy
import csv
import json
import math
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Optional

import numpy as np

from .config import RESULTS_DIR, RaceConfig, load_config
from .events import build_schedule
from .simulation import RaceEngine
from .strategy import AdaptivePolicy, FixedStintBaseline


@dataclass
class TrialResult:
    seed: int
    baseline_s: Optional[float]
    adaptive_s: Optional[float]
    saved_s: Optional[float]
    winner: str
    baseline_stops: int
    adaptive_stops: int
    baseline_mean_lap_s: Optional[float]
    adaptive_mean_lap_s: Optional[float]
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
    error: Optional[str]


def _category(has_rain: bool, has_sc: bool) -> str:
    if has_rain and has_sc:
        return "RAIN_AND_SC"
    if has_rain:
        return "RAIN_ONLY"
    if has_sc:
        return "SC_ONLY"
    return "DRY"


def run_trial(cfg: RaceConfig, seed: int, M: int) -> TrialResult:
    cat = "DRY"
    try:
        sched = build_schedule(cfg, seed)
        cat = _category(sched.has_rain(), sched.has_sc())
        base = RaceEngine(cfg, copy.deepcopy(sched), FixedStintBaseline(cfg))
        pol = AdaptivePolicy(cfg, M=M, seed=seed)
        adap = RaceEngine(cfg, copy.deepcopy(sched), pol)
        base.run_to_end()
        adap.run_to_end()
        saved = base.elapsed_s - adap.elapsed_s
        winner = "TIE" if abs(saved) < 1e-6 else ("ADAPTIVE" if saved > 0 else "BASELINE")
        ms = pol.decision_ms or [0.0]
        n = cfg.total_laps
        return TrialResult(
            seed=seed, baseline_s=base.elapsed_s, adaptive_s=adap.elapsed_s, saved_s=saved,
            winner=winner, baseline_stops=base.pit_stops, adaptive_stops=adap.pit_stops,
            baseline_mean_lap_s=base.elapsed_s / n, adaptive_mean_lap_s=adap.elapsed_s / n,
            replans=pol.replan_count, mean_decision_ms=float(np.mean(ms)), max_decision_ms=float(np.max(ms)),
            fuel_failures=adap.fuel_failures, tyre_violations=adap.tyre_violations,
            forced_pits_baseline=base.forced_pits, forced_pits_adaptive=adap.forced_pits,
            invalid_plans=adap.invalid_plans, baseline_invalid_plans=base.invalid_plans,
            baseline_tyre_violations=base.tyre_violations, completed=True, category=cat, error=None)
    except Exception as exc:  # a failed trial is recorded, never silently dropped
        return TrialResult(seed=seed, baseline_s=None, adaptive_s=None, saved_s=None, winner="TIE",
                           baseline_stops=0, adaptive_stops=0, baseline_mean_lap_s=None,
                           adaptive_mean_lap_s=None, replans=0, mean_decision_ms=0.0, max_decision_ms=0.0,
                           fuel_failures=0, tyre_violations=0, forced_pits_baseline=0,
                           forced_pits_adaptive=0, invalid_plans=0, baseline_invalid_plans=0,
                           baseline_tyre_violations=0, completed=False, category=cat,
                           error=f"{type(exc).__name__}: {exc}")


def _f(x: float) -> float:
    x = float(x)
    return x if math.isfinite(x) else 0.0


def summarize(trials: list[TrialResult], seed_start: int, config_name: str, runtime_s: float) -> dict:
    ok = [t for t in trials if t.completed]
    n = len(ok)
    saved = np.array([t.saved_s for t in ok]) if ok else np.array([0.0])
    b = np.array([t.baseline_s for t in ok]) if ok else np.array([0.0])
    a = np.array([t.adaptive_s for t in ok]) if ok else np.array([0.0])
    wins = sum(t.winner == "ADAPTIVE" for t in ok)
    losses = sum(t.winner == "BASELINE" for t in ok)
    ties = sum(t.winner == "TIE" for t in ok)
    std = float(np.std(saved, ddof=1)) if n > 1 else 0.0
    half = 1.96 * std / math.sqrt(n) if n > 1 else 0.0
    mean_saved = float(saved.mean())
    ms = np.array([t.mean_decision_ms for t in ok]) if ok else np.array([0.0])
    by_cat: dict = {}
    for cat in sorted({t.category for t in ok}):
        sub = [t for t in ok if t.category == cat]
        by_cat[cat] = {"n": len(sub), "mean_saved_s": _f(np.mean([t.saved_s for t in sub])),
                       "win_rate": _f(sum(t.winner == "ADAPTIVE" for t in sub) / len(sub)),
                       "loss_rate": _f(sum(t.winner == "BASELINE" for t in sub) / len(sub))}
    return {
        "trials": len(trials), "completed": n, "seed_start": seed_start,
        "seed_set": "eval" if seed_start >= 10000 else "dev",
        "baseline_mean_s": _f(b.mean()), "adaptive_mean_s": _f(a.mean()),
        "mean_saved_s": _f(mean_saved), "median_saved_s": _f(np.median(saved)), "std_saved_s": _f(std),
        "ci95_saved_s": [_f(mean_saved - half), _f(mean_saved + half)],
        "pct_improvement": _f(100.0 * (b.mean() - a.mean()) / b.mean()) if b.mean() else 0.0,
        "win_rate": _f(wins / n) if n else 0.0, "wins": wins, "losses": losses, "ties": ties,
        "invalid_plans": int(sum(t.invalid_plans for t in trials)),
        "baseline_invalid_plans": int(sum(t.baseline_invalid_plans for t in trials)),
        "tyre_violations": int(sum(t.tyre_violations for t in trials)),
        "baseline_tyre_violations": int(sum(t.baseline_tyre_violations for t in trials)),
        "fuel_failures": int(sum(t.fuel_failures for t in trials)),
        "failed_trials": len(trials) - n,
        "mean_decision_ms": _f(ms.mean()), "p95_decision_ms": _f(np.percentile(ms, 95)),
        "by_category": by_cat, "runtime_s": _f(runtime_s),
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "config_name": config_name,
    }


def run_benchmark(trials: int = 100, seed_start: int = 10000, scenarios: Optional[int] = None,
                  config_name: str = "default",
                  progress_cb: Optional[Callable[[int, int], None]] = None) -> dict:
    cfg = load_config(config_name)
    M = scenarios or cfg.optimizer.scenarios_benchmark
    t0 = time.perf_counter()
    out: list[TrialResult] = []
    for i in range(trials):
        out.append(run_trial(cfg, seed_start + i, M))
        if progress_cb:
            progress_cb(i + 1, trials)
    summary = summarize(out, seed_start, config_name, time.perf_counter() - t0)
    summary["scenarios"] = M
    return {"summary": summary, "trials": [asdict(t) for t in out]}


def export(results: dict, out_dir: Path | str = RESULTS_DIR) -> tuple[Path, Path]:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    jp, cp = out / f"benchmark_{stamp}.json", out / f"benchmark_{stamp}.csv"
    text = json.dumps(results, indent=2, allow_nan=False)
    for p in (jp, out / "latest.json"):
        p.write_text(text, encoding="utf-8")
    csv_text = trials_csv(results)
    for p in (cp, out / "latest.csv"):
        p.write_text(csv_text, encoding="utf-8", newline="")
    return jp, cp


def trials_csv(results: dict) -> str:
    import io
    buf = io.StringIO()
    rows = results["trials"]
    w = csv.DictWriter(buf, fieldnames=list(rows[0].keys()) if rows else ["seed"])
    w.writeheader()
    for r in rows:
        w.writerow(r)
    return buf.getvalue()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--trials", type=int, default=100)
    ap.add_argument("--seed-start", type=int, default=10000)
    ap.add_argument("--scenarios", type=int, default=None)
    ap.add_argument("--config", default="default")
    ap.add_argument("--out", default=str(RESULTS_DIR))
    args = ap.parse_args()
    res = run_benchmark(args.trials, args.seed_start, args.scenarios, args.config,
                        lambda d, t: print(f"{d}/{t}", flush=True) if d % 25 == 0 or d == t else None)
    print()
    jp, cp = export(res, args.out)
    s = res["summary"]
    print(f"seed set: {s['seed_set']} ({s['seed_start']}..{s['seed_start'] + s['trials'] - 1}), "
          f"{s['scenarios']} scenarios/decision, runtime {s['runtime_s']:.1f}s")
    print(f"baseline mean   {s['baseline_mean_s']:.2f}s\nadaptive mean   {s['adaptive_mean_s']:.2f}s")
    print(f"mean saved      {s['mean_saved_s']:.2f}s (median {s['median_saved_s']:.2f}, std {s['std_saved_s']:.2f}, "
          f"95% CI {s['ci95_saved_s'][0]:.2f}..{s['ci95_saved_s'][1]:.2f})")
    print(f"improvement     {s['pct_improvement']:.3f}%   win rate {s['win_rate']:.1%} "
          f"({s['wins']}W/{s['losses']}L/{s['ties']}T)  failed {s['failed_trials']}")
    print(f"invalid plans   adaptive {s['invalid_plans']}, baseline {s['baseline_invalid_plans']}; "
          f"tyre violations adaptive {s['tyre_violations']}, baseline {s['baseline_tyre_violations']}")
    print(f"decision        mean {s['mean_decision_ms']:.0f} ms, p95 {s['p95_decision_ms']:.0f} ms")
    for k, v in s["by_category"].items():
        print(f"  {k:12s} n={v['n']:3d} saved {v['mean_saved_s']:7.2f}s win {v['win_rate']:.0%} loss {v['loss_rate']:.0%}")
    print(f"wrote {jp} and {cp}")


if __name__ == "__main__":
    main()
