"""Hidden world: everything random about a race is pre-generated here from the seed.

Separate RNG child streams per phenomenon mean that consumption never depends on any policy
decision, so two engines given deepcopies of the same schedule see identical conditions.
Arrays are indexed by lap number 1..N (index 0 unused).
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .config import RaceConfig

EVENT_CODES = {"RAIN": 1, "CLEAR": 2, "SC_DEPLOY": 3, "SC_WITHDRAW": 4}


@dataclass
class WorldSchedule:
    n: int
    seed: int
    rain: np.ndarray        # rain intensity per lap (0 = none)
    sc: np.ndarray          # bool safety car per lap
    noise: np.ndarray       # lap-time noise (s)
    traffic: np.ndarray     # traffic penalty (s)
    wear_noise: np.ndarray  # multiplicative wear noise per lap
    deg_mult: float         # race-wide degradation multiplier

    def has_rain(self) -> bool:
        return bool(np.any(self.rain[1:] > 0))

    def has_sc(self) -> bool:
        return bool(np.any(self.sc[1:]))


def build_schedule(cfg: RaceConfig, seed: int | None = None) -> WorldSchedule:
    seed = cfg.seed if seed is None else seed
    n = cfg.total_laps
    ss = np.random.SeedSequence(seed).spawn(5)
    r_weather, r_sc, r_noise, r_traffic, r_wear = (np.random.default_rng(s) for s in ss)
    em, nz, dg = cfg.event_model, cfg.noise, cfg.degradation

    rain = np.zeros(n + 2)
    sc = np.zeros(n + 2, dtype=bool)
    # always draw, so stream consumption is identical whether or not events are enabled
    raining, intensity = False, 0.0
    for k in range(1, n + 1):
        u_start, u_stop = r_weather.random(), r_weather.random()
        u_int = r_weather.uniform(em.rain_intensity_min, em.rain_intensity_max)
        if not raining and u_start < em.p_rain_start_per_lap:
            raining, intensity = True, u_int
        elif raining and u_stop < em.rain_stop_prob_per_lap:
            raining = False
        rain[k] = intensity if raining else 0.0
    sc_left = 0
    for k in range(1, n + 1):
        u_start = r_sc.random()
        u_dur = int(r_sc.integers(em.sc_duration_min, em.sc_duration_max + 1))
        if sc_left == 0 and u_start < em.p_sc_per_lap and k > 1:
            sc_left = u_dur
        if sc_left > 0:
            sc[k] = True
            sc_left -= 1
    if not cfg.random_events:
        rain[:] = 0.0
        sc[:] = False

    noise = np.zeros(n + 2)
    traffic = np.zeros(n + 2)
    wear_noise = np.zeros(n + 2)
    noise[1:n + 1] = r_noise.normal(0.0, nz.lap_sigma_s, n)
    t_flag = r_traffic.random(n) < nz.traffic_prob
    t_amt = r_traffic.uniform(nz.traffic_min_s, nz.traffic_max_s, n)
    traffic[1:n + 1] = np.where(t_flag, t_amt, 0.0)
    wear_noise[1:n + 1] = r_wear.normal(0.0, dg.per_lap_sigma, n)
    deg = float(np.clip(1.0 + r_wear.normal(0.0, dg.race_mult_sigma), dg.race_mult_min, dg.race_mult_max))

    for ev in cfg.scripted_events:
        lo, hi = max(1, ev.lap), min(n, ev.lap + ev.duration - 1)
        if ev.type == "RAIN":
            rain[lo:hi + 1] = ev.intensity
        else:
            sc[lo:hi + 1] = True
    return WorldSchedule(n=n, seed=seed, rain=rain, sc=sc, noise=noise, traffic=traffic,
                         wear_noise=wear_noise, deg_mult=deg)


def apply_manual_event(sched: WorldSchedule, current_lap: int, ev_type: str,
                       intensity: float | None, cfg: RaceConfig) -> str:
    """Mutate the schedule from the next lap on. Deterministic given (seed, lap, type).
    Returns a short human description. Raises ValueError for invalid requests."""
    n, k = sched.n, current_lap + 1
    if k > n:
        raise ValueError("race is over")
    rng = np.random.default_rng([sched.seed, current_lap, EVENT_CODES[ev_type]])
    if ev_type == "RAIN":
        inten = 0.8 if intensity is None else float(intensity)
        d = int(rng.integers(6, 13))
        sched.rain[k:min(n, k + d - 1) + 1] = inten
        return f"Rain (intensity {inten:.2f}) from lap {k} for ~{d} laps"
    if ev_type == "CLEAR":
        if sched.rain[k] <= 0:
            raise ValueError("no rain to clear")
        j = k
        while j <= n and sched.rain[j] > 0:
            sched.rain[j] = 0.0
            j += 1
        return f"Rain cleared from lap {k}"
    if ev_type == "SC_DEPLOY":
        if sched.sc[k]:
            raise ValueError("safety car already deployed")
        d = int(rng.integers(cfg.event_model.sc_duration_min, cfg.event_model.sc_duration_max + 1))
        sched.sc[k:min(n, k + d - 1) + 1] = True
        return f"Safety car deployed from lap {k}"
    if ev_type == "SC_WITHDRAW":
        if not sched.sc[k]:
            raise ValueError("no safety car to withdraw")
        j = k
        while j <= n and sched.sc[j]:
            sched.sc[j] = False
            j += 1
        return f"Safety car withdrawn from lap {k}"
    raise ValueError(f"unknown event type {ev_type}")


def car_variant(sched: WorldSchedule, cfg: RaceConfig, car_idx: int) -> WorldSchedule:
    """Copy of the world for another car: SAME weather and safety-car laps, but its own lap noise,
    traffic, wear noise and degradation multiplier (deterministic in (seed, car_idx))."""
    import copy
    v = copy.deepcopy(sched)
    n, nz, dg = sched.n, cfg.noise, cfg.degradation
    ss = np.random.SeedSequence([sched.seed, 7000 + car_idx]).spawn(3)
    r_noise, r_traffic, r_wear = (np.random.default_rng(x) for x in ss)
    v.noise[1:n + 1] = r_noise.normal(0.0, nz.lap_sigma_s, n)
    flag = r_traffic.random(n) < nz.traffic_prob
    amt = r_traffic.uniform(nz.traffic_min_s, nz.traffic_max_s, n)
    v.traffic[1:n + 1] = np.where(flag, amt, 0.0)
    v.wear_noise[1:n + 1] = r_wear.normal(0.0, dg.per_lap_sigma, n)
    v.deg_mult = float(np.clip(1.0 + r_wear.normal(0.0, dg.race_mult_sigma), dg.race_mult_min, dg.race_mult_max))
    return v
