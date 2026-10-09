"""Possible futures sampled for the optimizer.

IMPORTANT: this module is built only from the public RaceSnapshot and the configured prior
(cfg.event_model). It must never import or receive the hidden WorldSchedule.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from .physics import next_wetness
from .simulation import RaceSnapshot


@dataclass
class Scenarios:
    M: int
    n: int
    k0: int                 # first lap being planned (= snapshot.lap + 1)
    wet: np.ndarray         # (M, n+2) track wetness used for lap k
    sc: np.ndarray          # (M, n+2) bool safety car on lap k
    deg: np.ndarray         # (M,) degradation multiplier
    traffic_s: float        # expected traffic penalty per lap (same in all scenarios)


def sample_scenarios(snap: RaceSnapshot, M: int, seed: int) -> Scenarios:
    cfg, n, k0 = snap.cfg, snap.total_laps, snap.lap + 1
    em = cfg.event_model
    rng = np.random.default_rng([int(seed) % (2 ** 32), 0x5EED])
    wet = np.zeros((M, n + 2))
    sc = np.zeros((M, n + 2), dtype=bool)
    deg = np.ones(M)
    exp_rain_dur = int(math.ceil(1.0 / max(1e-6, em.rain_stop_prob_per_lap)))
    mean_sc = int(round((em.sc_duration_min + em.sc_duration_max) / 2))

    for m in range(M):
        persistence = m == 0
        rain = np.zeros(n + 2)
        raining, inten = snap.rain_intensity > 0, snap.rain_intensity
        for k in range(k0, n + 1):
            u_start, u_stop = rng.random(), rng.random()
            u_int = rng.uniform(em.rain_intensity_min, em.rain_intensity_max)
            if k > k0:
                if persistence:
                    if raining and (k - k0) >= exp_rain_dur:
                        raining = False
                elif raining:
                    if u_stop < em.rain_stop_prob_per_lap:
                        raining = False
                elif u_start < em.p_rain_start_per_lap:
                    raining, inten = True, u_int
            rain[k] = inten if raining else 0.0
        wet[m, k0] = snap.track_wetness
        for k in range(k0 + 1, n + 1):
            wet[m, k] = next_wetness(wet[m, k - 1], rain[k], cfg)

        dur_total = int(rng.integers(em.sc_duration_min, em.sc_duration_max + 1))
        in_sc_left = 0
        if snap.sc_active:
            total = mean_sc if persistence else dur_total
            in_sc_left = max(1, total - snap.sc_laps_elapsed)
        for k in range(k0, n + 1):
            u_sc = rng.random()
            d_new = int(rng.integers(em.sc_duration_min, em.sc_duration_max + 1))
            if in_sc_left == 0 and k > k0 and not persistence and u_sc < em.p_sc_per_lap:
                in_sc_left = d_new
            if in_sc_left > 0:
                sc[m, k] = True
                in_sc_left -= 1
        z = rng.normal()
        deg[m] = snap.deg_estimate if persistence else float(
            np.clip(snap.deg_estimate * (1.0 + 0.05 * z), 0.7, 1.4))

    traffic = cfg.noise.traffic_prob * 0.5 * (cfg.noise.traffic_min_s + cfg.noise.traffic_max_s)
    return Scenarios(M=M, n=n, k0=k0, wet=wet, sc=sc, deg=deg, traffic_s=traffic)
