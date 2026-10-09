/**
 * Maps the AUTHORITATIVE per-lap timing produced by the backend race engine onto positions on the
 * circuit. Nothing here changes race physics: a car's position at race-time t is a pure function of
 * its recorded lap times (cumulative elapsed_s), so lap times, gaps and pit-loss shown in telemetry are
 * the same numbers that drive the animation.
 *
 * Time model
 *  - The backend steps one lap for all cars at a time ("lockstep"), then pushes one state.
 *  - For every car we therefore know its complete lap k once state.lap >= k.
 *  - The visual race clock may advance up to U_k = min over cars of elapsed_s after lap k (the leader
 *    has then finished lap k; every car's lap-k data is known). RaceClock eases from its current value
 *    to U_k over one simulation step, so rendering is smooth but never ahead of known data.
 */
import type { RaceState } from "../types/race";
import type { Circuit, Pose } from "./circuit";

export interface LapPoint { lap: number; lap_time_s: number; elapsed_s: number; pitted: boolean; pit_loss_s: number }

export interface PlaceOpts {
  L: number;            // circuit length (m)
  dIn: number;          // pit entry distance before the line, along the main straight (m)
  dOut: number;         // pit exit distance after the line (m)
  laneIn: number;       // pit lane distance from entry to the start line (m)
  laneOut: number;      // pit lane distance from the start line to the exit (m)
  ratio: number;        // share of the pit loss spent stationary
  gridFrac: number;     // lap fraction behind the line on the starting grid
  boxBeforeM: number;   // distance before the line at which this car's pit box sits (m)
  rollCap?: number;     // how far past the line (laps) this car coasts after the flag
}

export type Place =
  | { kind: "track"; frac: number; total: number; lapNo: number }
  | { kind: "pit"; s: number; total: number; lapNo: number; stopped: boolean };

function lapIndexAt(laps: LapPoint[], t: number): number {
  let lo = 0, hi = laps.length; // first lap whose elapsed_s > t
  while (lo < hi) { const mid = (lo + hi) >> 1; if (laps[mid].elapsed_s > t) hi = mid; else lo = mid + 1; }
  return lo;
}

export function placeCar(laps: LapPoint[], t: number, o: PlaceOpts): Place {
  if (laps.length === 0 || t <= 0) {
    return { kind: "track", frac: (1 - o.gridFrac) % 1, total: -o.gridFrac, lapNo: 1 };
  }
  const idx = lapIndexAt(laps, t);
  if (idx >= laps.length) {
    // past the last known lap (e.g. after the flag): roll on slowly beyond the line, never teleport
    const last = laps[laps.length - 1];
    const extra = Math.min(o.rollCap ?? 0.05, ((t - last.elapsed_s) / last.lap_time_s) * 0.5);
    return { kind: "track", frac: extra, total: laps.length + extra, lapNo: laps.length };
  }
  const lap = laps[idx];
  const start = idx === 0 ? 0 : laps[idx - 1].elapsed_s;
  const tt = t - start;
  const lt = lap.lap_time_s;
  const fe = 1 - o.dIn / o.L;
  const fx = o.dOut / o.L;
  const prevPitted = idx > 0 && laps[idx - 1].pitted;

  if (lap.pitted) {
    const tr = Math.max(1e-6, lt - lap.pit_loss_s);
    const tMain = tr * fe;
    if (tt < tMain) {
      const f = (tt / tMain) * fe;
      const frac = idx === 0 ? -o.gridFrac + (1 + o.gridFrac) * f : f;
      return { kind: "track", frac: (frac + 1) % 1, total: idx + frac, lapNo: lap.lap };
    }
    const tail = lt - tMain;
    const service = Math.min(lap.pit_loss_s * o.ratio, tail * 0.8);
    const travel = Math.max(1e-6, tail - service);
    const toBox = Math.max(1, o.laneIn - o.boxBeforeM);
    const travelA = travel * (toBox / o.laneIn);
    const t2 = tt - tMain;
    let s: number, stopped = false;
    if (t2 < travelA) s = (t2 / travelA) * toBox;
    else if (t2 < travelA + service) { s = toBox; stopped = true; }
    else s = toBox + ((t2 - travelA - service) / Math.max(1e-6, travel - travelA)) * (o.laneIn - toBox);
    return { kind: "pit", s: Math.min(s, o.laneIn), total: idx + fe + (s / o.laneIn) * (1 - fe), lapNo: lap.lap, stopped };
  }

  let f = tt / lt;
  if (idx === 0) f = -o.gridFrac + (1 + o.gridFrac) * f;
  if (prevPitted && f >= 0 && f < fx) {
    return { kind: "pit", s: o.laneIn + (f / fx) * o.laneOut, total: idx + f, lapNo: lap.lap, stopped: false };
  }
  return { kind: "track", frac: (f + 1) % 1, total: idx + f, lapNo: lap.lap };
}

export function poseOf(c: Circuit, p: Place): Pose {
  return p.kind === "track" ? c.pointAt(p.frac) : c.pitAt(p.s);
}

export function easeOut(k: number): number { return 1 - (1 - k) * (1 - k); }

/** Smooth visual race clock; never runs ahead of data the backend has produced. */
export class RaceClock {
  private from = 0;
  private to = 0;
  private t0 = 0;
  private dur = 1;
  private smooth = false;
  private key = "";
  private inited = false;

  now(): number {
    const k = Math.min(1, Math.max(0, (performance.now() - this.t0) / this.dur));
    return this.from + (this.to - this.from) * (this.smooth ? easeOut(k) : k);
  }

  update(s: RaceState): void {
    const target = clockTarget(s);
    const key = `${s.lap}|${s.status}|${s.speed}|${target.toFixed(3)}`;
    if (key === this.key) return;
    this.key = key;
    if (!this.inited) {            // first state (e.g. page loaded mid-race): start in place
      this.inited = true;
      this.from = this.to = target;
      this.t0 = performance.now(); this.dur = 1;
      return;
    }
    const cur = this.now();
    if (target < cur - 1e-6 || s.lap === 0) {          // reset / backwards: jump
      this.from = this.to = target;
      this.t0 = performance.now(); this.dur = 1;
      return;
    }
    this.from = cur;
    this.to = target;
    this.t0 = performance.now();
    this.smooth = s.status !== "running";
    this.dur = s.status === "running" ? 3000 / s.speed : 1400;
  }
}

/** Latest race time for which every car's position is fully known. */
export function clockTarget(s: RaceState): number {
  if (s.lap === 0 || s.cars.length === 0) return 0;
  const lastElapsed = (laps: { elapsed_s: number }[]) => (laps.length ? laps[laps.length - 1].elapsed_s : 0);
  const ends = s.cars.map((c) => lastElapsed(c.laps));
  if (s.baseline) {
    let t = 0;
    ends.push(s.baseline.laps.reduce((a, l) => (t = a + l.lap_time_s), 0));
  }
  return s.status === "finished" ? Math.max(...ends) : Math.min(...ends);
}

export function baselineLaps(s: RaceState): LapPoint[] {
  if (!s.baseline) return [];
  let t = 0;
  return s.baseline.laps.map((l) => {
    t += l.lap_time_s;
    return { lap: l.lap, lap_time_s: l.lap_time_s, elapsed_s: t, pitted: l.pitted, pit_loss_s: l.pit_loss_s ?? 0 };
  });
}

export function placeOptsFor(c: Circuit, ratio: number, gridSlot: number, boxIndex: number, nCars: number): PlaceOpts {
  const gap = 8.5; // grid slot spacing along the track (m), pole nearest the line
  const dIn = (c.data.pit_lane.entry_distance_m);
  return {
    L: c.length, dIn, dOut: c.data.pit_lane.exit_distance_m, laneIn: c.pit.lineDist, laneOut: c.pit.length - c.pit.lineDist, ratio,
    gridFrac: (gridSlot * gap + 6) / c.length, boxBeforeM: Math.min(c.pit.lineDist - 6, boxIndex * 11),
  };
}
