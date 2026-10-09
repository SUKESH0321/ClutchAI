import type { Circuit } from "./circuit";

/**
 * A visual speed profile around the circuit: cars brake for corners and accelerate out of them.
 *
 * Target speed at each point is limited by lateral grip (v = sqrt(a_lat / |curvature|)), then smoothed by finite
 * braking and acceleration limits (backward and forward passes around the closed loop). The profile is only used to
 * REDISTRIBUTE distance within a lap: the authoritative lap time still decides when a car crosses the line, so lap
 * boundaries, gaps, fuel and wear are untouched. `warp(a, b, u)` turns a fraction of elapsed time `u` over the stretch
 * [a, b] of the lap (as lap fractions) into the lap fraction reached by then.
 */
export interface SpeedProfile {
  /** lap fraction reached after time fraction u (0..1) of travelling from lap fraction a to b */
  warp(a: number, b: number, u: number): number;
  /** relative speed (mean = 1) at a lap fraction, for tests and effects */
  speedAt(frac: number): number;
  peakOverMean: number;
  /** deceleration (m/s^2, >0 = braking) per circuit sample, from the unscaled profile */
  brake: Float32Array;
}

const A_LAT = 36, A_BRAKE = 42, A_ACCEL = 13, V_MIN = 21, V_MAX = 90;

const cache = new WeakMap<Circuit, SpeedProfile>();

export function speedProfileFor(c: Circuit): SpeedProfile {
  const hit = cache.get(c);
  if (hit) return hit;
  const n = c.n, ds = c.length / n;
  // smooth the signed curvature over a few samples so single-sample noise does not create fake corners
  const k = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = -3; j <= 3; j++) s += Math.abs(c.kappa[(i + j + n) % n]);
    k[i] = s / 7;
  }
  const v = new Float64Array(n);
  for (let i = 0; i < n; i++) v[i] = Math.min(V_MAX, Math.max(V_MIN, Math.sqrt(A_LAT / Math.max(k[i], 1e-5))));
  for (let pass = 0; pass < 3; pass++) {
    for (let i = n - 1; i >= -n; i--) {                       // braking: v[i] <= sqrt(v[i+1]^2 + 2 a ds)
      const a = ((i % n) + n) % n, b = (a + 1) % n;
      v[a] = Math.min(v[a], Math.sqrt(v[b] * v[b] + 2 * A_BRAKE * ds));
    }
    for (let i = 0; i < 2 * n; i++) {                          // acceleration: v[i+1] <= sqrt(v[i]^2 + 2 a ds)
      const a = i % n, b = (a + 1) % n;
      v[b] = Math.min(v[b], Math.sqrt(v[a] * v[a] + 2 * A_ACCEL * ds));
    }
  }
  // cumulative time (normalised so the full lap = 1); T[i] is the time at sample i, T[n] closes the loop
  const T = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) T[i + 1] = T[i] + ds / (0.5 * (v[i] + v[(i + 1) % n]));
  const total = T[n];
  for (let i = 0; i <= n; i++) T[i] /= total;
  const mean = c.length / total;

  const timeAt = (frac: number) => {                           // frac in [0,1]
    const x = Math.min(1, Math.max(0, frac)) * n, i = Math.min(n - 1, Math.floor(x));
    return T[i] + (T[i + 1] - T[i]) * (x - i);
  };
  const fracAt = (t: number) => {                              // inverse of timeAt (binary search)
    let lo = 0, hi = n;
    while (lo < hi - 1) { const mid = (lo + hi) >> 1; if (T[mid] <= t) lo = mid; else hi = mid; }
    const seg = T[hi] - T[lo];
    return (lo + (seg > 0 ? (t - T[lo]) / seg : 0)) / n;
  };
  const brake = new Float32Array(n);
  for (let i = 0; i < n; i++) brake[i] = Math.max(0, (v[i] * v[i] - v[(i + 1) % n] * v[(i + 1) % n]) / (2 * ds));
  const profile: SpeedProfile = {
    brake,
    warp(a, b, u) {
      const ta = timeAt(a), tb = timeAt(b);
      return fracAt(ta + (tb - ta) * Math.min(1, Math.max(0, u)));
    },
    speedAt(frac) { const i = Math.min(n - 1, Math.max(0, Math.floor(frac * n))); return v[i] / mean; },
    peakOverMean: Math.max(...v) / mean,
  };
  cache.set(c, profile);
  return profile;
}
