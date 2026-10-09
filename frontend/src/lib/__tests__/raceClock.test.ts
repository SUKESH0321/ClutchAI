import { describe, expect, it } from "vitest";
import { getCircuit } from "../circuit";
import { placeCar, placeOptsFor, poseOf, type LapPoint } from "../raceClock";

const c = getCircuit("silverstone");

function laps(n: number, base: number, pitLaps: number[], loss = 25): LapPoint[] {
  const out: LapPoint[] = [];
  let t = 0;
  for (let i = 1; i <= n; i++) {
    const pit = pitLaps.includes(i);
    const lt = base + (pit ? loss : 0);
    t += lt;
    out.push({ lap: i, lap_time_s: lt, elapsed_s: t, pitted: pit, pit_loss_s: pit ? loss : 0 });
  }
  return out;
}

describe("circuit data", () => {
  it("is a closed ~5.9 km Silverstone-length loop", () => {
    expect(c.length).toBeGreaterThan(5800);
    expect(c.length).toBeLessThan(5950);
    const a = c.pointAt(0), b = c.pointAt(0.9999);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(15);
  });
  it("pit lane starts and ends on the track centerline", () => {
    const i0 = c.pitAt(0), i1 = c.pitAt(c.pit.length);
    const mainIn = c.pointAt(1 - c.data.pit_lane.entry_distance_m / c.length);
    const mainOut = c.pointAt(c.data.pit_lane.exit_distance_m / c.length);
    expect(Math.hypot(i0.x - mainIn.x, i0.y - mainIn.y)).toBeLessThan(8);
    expect(Math.hypot(i1.x - mainOut.x, i1.y - mainOut.y)).toBeLessThan(8);
  });
});

describe("placeCar", () => {
  const o = placeOptsFor(c, 0.8, 5, 0, 8);
  const L = laps(6, 92, [3]);

  it("never teleports, including through the pit lane (max step per 50 ms)", () => {
    const end = L[L.length - 1].elapsed_s;
    let prev = poseOf(c, placeCar(L, 0.0001, o));
    let maxStep = 0;
    for (let t = 0.05; t < end; t += 0.05) {
      const p = poseOf(c, placeCar(L, t, o));
      maxStep = Math.max(maxStep, Math.hypot(p.x - prev.x, p.y - prev.y));
      prev = p;
    }
    // top speed on the loop is ~ L/92 = 64 m/s -> ~3.2 m per 50 ms; allow slack for the grid launch / lane joins
    expect(maxStep).toBeLessThan(6);
  });

  it("tracks the lap boundaries: lap k ends at the start line", () => {
    for (const lap of L) {
      const p = placeCar(L, lap.elapsed_s - 1e-3, o);
      const pose = poseOf(c, p);
      const line = c.pointAt(0);
      // a pitted lap ends in the pit lane beside the line (lateral offset), others on the centerline
      const expected = lap.pitted ? c.data.pit_lane.offset_m : 0;
      expect(Math.abs(Math.hypot(pose.x - line.x, pose.y - line.y) - expected)).toBeLessThan(10);
    }
  });

  it("is in the pit lane during the pitted lap and stationary for the service time", () => {
    const start = L[1].elapsed_s;                 // lap 3 begins
    const lapLen = L[2].lap_time_s;
    let inPit = 0, stopped = 0;
    for (let t = start; t < start + lapLen; t += 0.1) {
      const p = placeCar(L, t, o);
      if (p.kind === "pit") { inPit++; if (p.stopped) stopped++; }
    }
    expect(inPit).toBeGreaterThan(0);
    expect(stopped * 0.1).toBeCloseTo(25 * 0.8, 0);   // service share of the pit loss
    // other laps never use the pit lane except the exit of the lap after the stop
    expect(placeCar(L, L[0].elapsed_s - 5, o).kind).toBe("track");
  });

  it("orients along the direction of travel", () => {
    const a = poseOf(c, placeCar(L, 40, o)), b = poseOf(c, placeCar(L, 40.5, o));
    const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy);
    expect((dx / l) * a.tx + (dy / l) * a.ty).toBeGreaterThan(0.95);
  });

  it("starts on the grid behind the line", () => {
    const p = placeCar(L, 0, o);
    expect(p.total).toBeLessThan(0);
  });
});

import { speedProfileFor } from "../speedProfile";

describe("speed profile", () => {
  const prof = speedProfileFor(c);
  it("keeps exact endpoints and is monotonic (lap boundaries stay authoritative)", () => {
    expect(prof.warp(0, 1, 0)).toBeCloseTo(0, 6);
    expect(prof.warp(0, 1, 1)).toBeCloseTo(1, 3);
    expect(prof.warp(0, 0.7, 1)).toBeCloseTo(0.7, 3);
    let prev = -1;
    for (let u = 0; u <= 1.0001; u += 0.005) { const f = prof.warp(0, 1, u); expect(f).toBeGreaterThanOrEqual(prev); prev = f; }
  });
  it("is slower in the tightest corner than on the fastest straight, with a believable range", () => {
    let lo = 1e9, hi = 0;
    for (let i = 0; i < 400; i++) { const v = prof.speedAt(i / 400); lo = Math.min(lo, v); hi = Math.max(hi, v); }
    expect(hi / lo).toBeGreaterThan(1.8);
    expect(prof.peakOverMean).toBeLessThan(1.65);
  });
  it("cars still finish each lap exactly when the data says, and never move backwards", () => {
    const o = placeOptsFor(c, 0.8, 5, 0, 8);
    const L = laps(4, 92, [2]);
    let prev = -1;
    for (let t = 0.05; t < L[3].elapsed_s; t += 0.05) {
      const total = placeCar(L, t, o).total;
      expect(total).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = total;
    }
    expect(placeCar(L, L[1].elapsed_s + 0.001, o).lapNo).toBe(3);
  });
});
