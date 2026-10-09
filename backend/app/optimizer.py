"""Rolling-horizon strategy optimizer.

Key idea: with no in-race refuelling, fuel burn, wetness and safety-car laps depend only on the
scenario, not on the pit plan. Therefore the cost of a *fresh* stint (compound c, laps s..e) is a
function of (scenario, c, s, e) only. We precompute those with physics.lap_time (the same function
the race engine uses), then price every candidate plan by summing table entries. Pit stops cost
physics.pit_loss on the pit lap in that scenario (cheaper under a safety car).

Search: exhaustive enumeration of all feasible plans with 0, 1 or 2 further stops (laps x
compounds). Plans with 3+ stops are NOT searched (documented limitation). Stints that would exceed
max_wear in ANY sampled scenario are rejected (robust feasibility).
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Optional

import numpy as np

from .config import ALL_COMPOUNDS
from .physics import (LapInputs, fuel_burn, lap_time, next_wear, pit_loss, wear_increment,
                      weather_label)
from .scenarios import Scenarios, sample_scenarios
from .simulation import RaceSnapshot, rule_ok

COMPS = list(ALL_COMPOUNDS)
CI = {c: i for i, c in enumerate(COMPS)}


@dataclass
class Tables:
    snap: RaceSnapshot
    scn: Scenarios
    fs: np.ndarray        # fuel at start of lap (M, n+2)
    pen: np.ndarray       # fuel-save penalty (M, n+2)
    fuel_end0: float      # projected fuel after the last lap, scenario 0
    T: np.ndarray         # (4, n+2, n+2, M) fresh-stint cumulative cost laps s..e
    CUR: np.ndarray       # (n+2, M) continuing current tyres through lap e
    P: np.ndarray         # (n+2, M) pit loss if pitting on lap L


def _lap_total(cfg, c, w, k, scn: Scenarios, fs, pen, m) -> float:
    return lap_time(LapInputs(c, float(w), float(fs[m, k]), float(scn.wet[m, k]),
                              bool(scn.sc[m, k]), scn.traffic_s, 0.0, float(pen[m, k])), cfg).total


def build_tables(snap: RaceSnapshot, scn: Scenarios, enforce_wear: bool = True) -> Tables:
    cfg, n, k0, M = snap.cfg, snap.total_laps, scn.k0, scn.M
    fs = np.zeros((M, n + 2))
    pen = np.zeros((M, n + 2))
    fuel_end0 = 0.0
    for m in range(M):
        f = snap.fuel_kg
        for k in range(k0, n + 1):
            burn, pn = fuel_burn(f, n - k + 1, bool(scn.sc[m, k]), cfg)
            fs[m, k], pen[m, k] = f, pn
            f = max(0.0, f - burn)
        if m == 0:
            fuel_end0 = f
    cap = cfg.max_wear + 1e-9 if enforce_wear else 1e9

    T = np.full((len(COMPS), n + 2, n + 2, M), np.inf)
    CUR = np.full((n + 2, M), np.inf)
    P = np.zeros((n + 2, M))
    for L in range(k0, n + 1):
        for m in range(M):
            P[L, m] = pit_loss(bool(scn.sc[m, L]), cfg)

    allowed = int(cfg.optimizer.infeasible_tolerance * M) if enforce_wear else M
    recourse = cfg.pit.service_s + cfg.pit.transit_s + 5.0   # assumed cost of an unplanned stop

    def run(c: str, w0: float, start: int, sink) -> None:
        w = np.full(M, w0)
        cum = np.zeros(M)
        dead = np.zeros(M, dtype=bool)
        for e in range(start, n + 1):
            t = np.empty(M)
            nw = np.empty(M)
            for m in range(M):
                t[m] = _lap_total(cfg, c, w[m], e, scn, fs, pen, m)
                nw[m] = next_wear(w[m], wear_increment(c, float(scn.wet[m, e]), bool(scn.sc[m, e]),
                                                       float(scn.deg[m]), cfg))
            newly = (nw > cap) & ~dead
            if enforce_wear:
                # a future that hits the wear limit is charged a recourse (forced stop); too many -> reject
                if (dead | newly).sum() > allowed:
                    return
                cum = cum + np.where(newly, recourse, 0.0)
                dead |= newly
            elif nw.max() > cap:
                return
            cum = cum + t
            w = nw
            sink(e, cum.copy())

    def cur_sink(e, v):
        CUR[e] = v
    run(snap.compound, snap.wear, k0, cur_sink)
    for c in COMPS:
        if snap.available.get(c, 0) <= 0:
            continue
        for s in range(k0 + 1, n + 1):
            def sink(e, v, _ci=CI[c], _s=s):
                T[_ci, _s, e] = v
            run(c, 0.0, s, sink)
    return Tables(snap, scn, fs, pen, fuel_end0, T, CUR, P)


def _objective(vec: np.ndarray, lam: float) -> float:
    mean = float(vec.mean())
    if lam <= 0:
        return mean
    k = max(1, int(np.ceil(0.1 * len(vec))))
    return mean + lam * float(np.sort(vec)[-k:].mean())


def plan_vec(tb: Tables, stops: list) -> tuple[Optional[np.ndarray], str]:
    """Cost vector (per scenario) of an arbitrary plan, or (None, reason) if infeasible."""
    snap, cfg, n = tb.snap, tb.snap.cfg, tb.snap.total_laps
    k0 = tb.scn.k0
    prev, avail, used = k0 - 1, dict(snap.available), set(snap.compounds_used)
    if len(stops) > 2:
        return None, "more than 2 stops"
    if not stops:
        v = tb.CUR[n]
        if not np.isfinite(v[0]):
            return None, "tyre limit"
        return (v.copy(), "") if rule_ok(cfg, used) else (None, "two-compound rule")
    for i, (L, c) in enumerate(stops):
        if not (k0 <= L <= n - 1) or (i > 0 and L - prev < cfg.min_stint_laps):
            return None, "pit lap out of range / stint too short"
        if n - L < cfg.min_stint_laps and i == len(stops) - 1:
            return None, "final stint too short"
        if avail.get(c, 0) <= 0:
            return None, "compound unavailable"
        avail[c] -= 1
        used.add(c)
        prev = L
    if not rule_ok(cfg, used):
        return None, "two-compound rule"
    first = stops[0][0]
    v = tb.CUR[first].copy()
    if not np.isfinite(v[0]):
        return None, "tyre limit"
    for i, (L, c) in enumerate(stops):
        v = v + tb.P[L]
        end = stops[i + 1][0] if i + 1 < len(stops) else n
        seg = tb.T[CI[c], L + 1, end]
        if not np.isfinite(seg[0]):
            return None, "tyre limit"
        v = v + seg
    return v, ""


@dataclass
class Cand:
    obj: float
    stops: tuple
    vec: np.ndarray


def enumerate_plans(tb: Tables, relax_rule: bool = False) -> tuple[list, dict]:
    snap, cfg, n = tb.snap, tb.snap.cfg, tb.snap.total_laps
    k0, lam = tb.scn.k0, cfg.optimizer.cvar_lambda
    minst = cfg.min_stint_laps
    used0, avail = set(snap.compounds_used), snap.available
    stats = {"evaluated": 0, "rejected": {}}

    def rej(reason):
        stats["evaluated"] += 1
        stats["rejected"][reason] = stats["rejected"].get(reason, 0) + 1

    out: list[Cand] = []

    def accept(stops, vec):
        stats["evaluated"] += 1
        out.append(Cand(_objective(vec, lam), stops, vec))

    def ok_rule(extra):
        return relax_rule or rule_ok(cfg, used0 | set(extra))

    if np.isfinite(tb.CUR[n][0]):
        if ok_rule([]):
            accept((), tb.CUR[n].copy())
        else:
            rej("two-compound rule")
    else:
        rej("tyre limit")
    max_stops = min(cfg.max_stops, 2)
    if max_stops >= 1:
        for L1 in range(k0, n - minst + 1):
            if not np.isfinite(tb.CUR[L1][0]):
                rej("tyre limit (current set)")
                break
            base1 = tb.CUR[L1] + tb.P[L1]
            for c1 in COMPS:
                if avail.get(c1, 0) < 1:
                    continue
                last = tb.T[CI[c1], L1 + 1, n]
                if np.isfinite(last[0]) and ok_rule([c1]):
                    accept(((L1, c1),), base1 + last)
                else:
                    rej("tyre limit" if not np.isfinite(last[0]) else "two-compound rule")
                if max_stops < 2:
                    continue
                for L2 in range(L1 + minst, n - minst + 1):
                    mid = tb.T[CI[c1], L1 + 1, L2]
                    if not np.isfinite(mid[0]):
                        rej("tyre limit")
                        break
                    base2 = base1 + mid + tb.P[L2]
                    for c2 in COMPS:
                        need = 2 if c2 == c1 else 1
                        if avail.get(c2, 0) < need:
                            continue
                        fin = tb.T[CI[c2], L2 + 1, n]
                        if not np.isfinite(fin[0]):
                            rej("tyre limit")
                        elif not ok_rule([c1, c2]):
                            rej("two-compound rule")
                        else:
                            accept(((L1, c1), (L2, c2)), base2 + fin)
    out.sort(key=lambda c: (c.obj, len(c.stops), c.stops))
    return out, stats


def simulate_plan(tb: Tables, stops: list, m: int = 0) -> tuple[list, float]:
    """Step a plan through scenario m with physics directly. Returns (per-lap rows, total time).
    Independent of the table arithmetic, used for projections and cross-checks."""
    snap, scn, cfg, n = tb.snap, tb.scn, tb.snap.cfg, tb.snap.total_laps
    stop_at = {L: c for L, c in stops}
    comp, w = snap.compound, snap.wear
    rows, total = [], 0.0
    for k in range(scn.k0, n + 1):
        t = _lap_total(cfg, comp, w, k, scn, tb.fs, tb.pen, m)
        w_end = next_wear(w, wear_increment(comp, float(scn.wet[m, k]), bool(scn.sc[m, k]),
                                            float(scn.deg[m]), cfg))
        rows.append({"lap": k, "lap_time_s": float(t), "wear": float(w_end),
                     "fuel_kg": float(tb.fs[m, k]), "compound": comp})
        total += t
        if k in stop_at:
            total += float(tb.P[k, m])
            comp, w = stop_at[k], 0.0
        else:
            w = w_end
    return rows, total


@dataclass
class Recommendation:
    action: str
    pit_lap: Optional[int]
    compound: Optional[str]
    plan: list
    projected_finish_s: float
    current_plan: Optional[list]
    current_plan_projected_finish_s: Optional[float]
    best_alternative: Optional[dict]
    time_advantage_s: float
    action_options: list
    top_candidates: list
    candidates_evaluated: int
    candidates_feasible: int
    scenarios: int
    scenario_win_share: float
    trigger: str
    explanation: str
    warnings: list
    computed_at_lap: int
    decision_ms: float
    projection: list = field(default_factory=list)


def _plan_list(stops) -> list:
    return [{"lap": int(L), "compound": c} for L, c in stops]


def _describe(stops) -> str:
    if not stops:
        return "no further stop"
    return " then ".join(f"box L{L} for {c}" for L, c in stops)


def _summ(cand: Cand, elapsed: float) -> dict:
    return {"plan": _plan_list(cand.stops), "expected_s": float(elapsed + cand.vec.mean()),
            "p10_s": float(elapsed + np.percentile(cand.vec, 10)),
            "p90_s": float(elapsed + np.percentile(cand.vec, 90))}


def _explain(snap: RaceSnapshot, tb: Tables, chosen: Cand, alt: Optional[Cand], adv: float,
             share: float, trigger: str) -> str:
    cfg, k0 = snap.cfg, tb.scn.k0
    parts = []
    first = chosen.stops[0] if chosen.stops else None
    pl_now = pit_loss(snap.sc_active, cfg)
    if first and first[0] == k0:
        parts.append(f"Box this lap for {first[1]} ({pl_now:.1f}s pit loss"
                     f"{', reduced under the safety car' if snap.sc_active else ''}).")
    elif first:
        parts.append(f"Stay out; next stop planned on lap {first[0]} for {first[1]}.")
    else:
        parts.append("No further stop needed; current tyres and fuel reach the flag.")
    if alt is not None:
        parts.append(f"Expected finish {snap.elapsed_s + chosen.vec.mean():.1f}s vs "
                     f"{snap.elapsed_s + alt.vec.mean():.1f}s for the best alternative "
                     f"({_describe(alt.stops)}): {adv:.1f}s faster, better in "
                     f"{int(round(share * tb.scn.M))}/{tb.scn.M} sampled futures.")
    wet = snap.track_wetness
    if wet >= 0.2 and snap.compound != "WET":
        cur = lap_time(LapInputs(snap.compound, snap.wear, snap.fuel_kg, wet, False), cfg).total
        wt = lap_time(LapInputs("WET", 0.0, snap.fuel_kg, wet, False), cfg).total
        parts.append(f"Track wetness {wet:.2f} ({weather_label(wet)}): {snap.compound} is "
                     f"{cur - wt:+.1f}s/lap vs a fresh WET set.")
    elif wet >= 0.2:
        parts.append(f"Track wetness {wet:.2f} ({weather_label(wet)}) suits WET tyres.")
    if snap.sc_active:
        parts.append(f"Safety car out: a stop costs {pl_now:.1f}s instead of {pit_loss(False, cfg):.1f}s.")
    if snap.wear > 0.5:
        parts.append(f"Tyre wear {snap.wear:.0%} of the {cfg.max_wear:.0%} limit.")
    parts.append(f"Replanned because: {trigger.replace('_', ' ').lower()}.")
    return " ".join(parts)


def optimize(snap: RaceSnapshot, M: int, seed: int, current_plan: Optional[list] = None,
             trigger: str = "MANUAL_REFRESH") -> Recommendation:
    t0 = time.perf_counter()
    cfg, n, k0 = snap.cfg, snap.total_laps, snap.lap + 1
    warnings: list[str] = []
    scn = sample_scenarios(snap, M, seed)
    tb = build_tables(snap, scn)
    cands, stats = enumerate_plans(tb)
    if not cands:
        warnings.append("No plan satisfies the two-compound rule; rule relaxed for this recommendation.")
        cands, stats2 = enumerate_plans(tb, relax_rule=True)
        stats["evaluated"] += stats2["evaluated"]
    if not cands:
        warnings.append("No plan keeps tyres within the wear limit; wear limit ignored for this recommendation.")
        tb = build_tables(snap, scn, enforce_wear=False)
        cands, stats2 = enumerate_plans(tb, relax_rule=True)
        stats["evaluated"] += stats2["evaluated"]
    if not cands:
        vec = tb.CUR[n].copy()
        cands = [Cand(float(vec.mean()), (), vec)]
    lam = cfg.optimizer.cvar_lambda
    best = cands[0]

    # hysteresis: keep the existing plan unless the new one is clearly better
    cur_list = [(int(s["lap"]), s["compound"]) for s in (current_plan or []) if s["lap"] >= k0]
    cur_vec, _ = plan_vec(tb, cur_list) if current_plan is not None else (None, "")
    cur_obj = _objective(cur_vec, lam) if cur_vec is not None else None
    chosen = best
    if cur_vec is not None and cur_obj - best.obj < cfg.optimizer.hysteresis_s:
        chosen = Cand(cur_obj, tuple(cur_list), cur_vec)

    def immediate(c: Cand) -> str:
        return "BOX_THIS_LAP" if c.stops and c.stops[0][0] == k0 else "STAY_OUT"

    act = immediate(chosen)
    options = []
    for a in ("BOX_THIS_LAP", "STAY_OUT"):
        b = next((c for c in cands if immediate(c) == a), None)
        options.append({"action": a, "best_plan": _plan_list(b.stops) if b else None,
                        "projected_finish_s": float(snap.elapsed_s + b.vec.mean()) if b else None})
    alt = next((c for c in cands if immediate(c) != act), None)
    if alt is None:
        alt = next((c for c in cands if c.stops != chosen.stops), None)
    adv = float(alt.obj - chosen.obj) if alt is not None else 0.0
    share = float(np.mean(chosen.vec <= alt.vec + 1e-9)) if alt is not None else 1.0

    rows, _ = simulate_plan(tb, list(chosen.stops), 0)
    if tb.fuel_end0 < cfg.fuel.reserve_kg:
        warnings.append(f"Projected fuel at the flag {tb.fuel_end0:.2f}kg is below the {cfg.fuel.reserve_kg:.1f}kg reserve.")
    first = chosen.stops[0] if chosen.stops else None
    return Recommendation(
        action=act, pit_lap=int(first[0]) if first else None,
        compound=first[1] if first else None, plan=_plan_list(chosen.stops),
        projected_finish_s=float(snap.elapsed_s + chosen.vec.mean()),
        current_plan=_plan_list(cur_list) if cur_vec is not None else None,
        current_plan_projected_finish_s=float(snap.elapsed_s + cur_vec.mean()) if cur_vec is not None else None,
        best_alternative=_summ(alt, snap.elapsed_s) if alt is not None else None,
        time_advantage_s=adv, action_options=options,
        top_candidates=[_summ(c, snap.elapsed_s) for c in cands[:5]],
        candidates_evaluated=int(stats["evaluated"]), candidates_feasible=len(cands),
        scenarios=M, scenario_win_share=share, trigger=trigger,
        explanation=_explain(snap, tb, chosen, alt, adv, share, trigger), warnings=warnings,
        computed_at_lap=snap.lap, decision_ms=(time.perf_counter() - t0) * 1000.0, projection=rows)
