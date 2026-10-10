import { describe, expect, it } from "vitest";
import { getCircuit, listCircuits } from "../circuit";
import { BROADLEAF, BUSH, BUSH_CLEARANCE_M, CONIFER, TREE_CLEARANCE_M, PIT_CLEARANCE_M, cornerOpenZones, edgeDistance, pitDistance, planVegetation } from "../vegetation";
import { VEGETATION } from "../quality";

const flat = () => 0;

describe.each(listCircuits().map((d) => d.id))("vegetation on %s", (id) => {
  const c = getCircuit(id);
  const stand = { x: c.x[10], z: -c.y[10] + 60, r: 60 };
  const plan = planVegetation(c, flat, { trees: VEGETATION.high.trees, bushes: VEGETATION.high.bushes, exclusions: [stand] });

  it("meets the requested density", () => {
    expect(plan.trees.length).toBeGreaterThan(VEGETATION.high.trees * 0.9);
    expect(plan.trees.length).toBeLessThan(VEGETATION.high.trees * 1.1);
    expect(plan.bushes.length).toBeGreaterThan(VEGETATION.high.bushes * 0.9);
  });
  it("keeps every tree and bush clear of the track edge, runoff and pit lane", () => {
    for (const t of plan.trees) {
      expect(edgeDistance(c, t.x, t.z)).toBeGreaterThanOrEqual(TREE_CLEARANCE_M - 1e-6);
    }
    for (const b of plan.bushes) expect(edgeDistance(c, b.x, b.z)).toBeGreaterThanOrEqual(BUSH_CLEARANCE_M - 1e-6);
    // sample (pit distance is a linear scan)
    for (let k = 0; k < plan.trees.length; k += 7) expect(pitDistance(c, plan.trees[k].x, plan.trees[k].z)).toBeGreaterThanOrEqual(PIT_CLEARANCE_M - 24);
  });
  it("respects grandstand exclusions and the open sight-line zones on the outside of corners", () => {
    for (const t of plan.trees) expect(Math.hypot(t.x - stand.x, t.z - stand.z)).toBeGreaterThanOrEqual(stand.r - 24);
    const zones = cornerOpenZones(c);
    let inside = 0;
    for (const t of plan.trees) for (const z of zones) if (Math.hypot(t.x - z.x, t.z - z.z) < z.r - 24) inside++;
    expect(inside).toBe(0);
  });
  it("is varied: many species, sizes and rotations; small trees near the circuit, tall ones behind", () => {
    expect(new Set(plan.trees.map((t) => t.species)).size).toBeGreaterThanOrEqual(10);
    expect(new Set(plan.bushes.map((t) => t.species)).size).toBe(BUSH);
    expect(Math.max(...plan.trees.map((t) => t.species))).toBeLessThan(BROADLEAF + CONIFER);
    const hs = plan.trees.map((t) => t.h);
    expect(Math.max(...hs) - Math.min(...hs)).toBeGreaterThan(8);
    const near = plan.trees.filter((t) => edgeDistance(c, t.x, t.z) < 90).map((t) => t.h);
    const far = plan.trees.filter((t) => edgeDistance(c, t.x, t.z) > 300).map((t) => t.h);
    const avg = (a: number[]) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
    expect(avg(near)).toBeLessThan(avg(far));
  });
  it("is dense and continuous (forest clusters, not a thin scatter) and deterministic", () => {
    const cells = new Set(plan.trees.map((t) => `${Math.floor(t.x / 100)},${Math.floor(t.z / 100)}`));
    expect(cells.size).toBeGreaterThan(300);
    const counts = new Map<string, number>();
    for (const t of plan.trees) { const k = `${Math.floor(t.x / 100)},${Math.floor(t.z / 100)}`; counts.set(k, (counts.get(k) ?? 0) + 1); }
    expect(Math.max(...counts.values())).toBeGreaterThan(40);               // real forest stands exist
    const again = planVegetation(c, flat, { trees: VEGETATION.high.trees, bushes: VEGETATION.high.bushes, exclusions: [stand] });
    expect(again.trees.length).toBe(plan.trees.length);
    expect(again.trees[100].x).toBe(plan.trees[100].x);
  });
});

it("density levels scale: ultra has several times the trees of low", () => {
  const c = getCircuit("silverstone");
  const n = (l: keyof typeof VEGETATION) => planVegetation(c, flat, { trees: VEGETATION[l].trees, bushes: VEGETATION[l].bushes, exclusions: [] }).trees.length;
  expect(n("ultra")).toBeGreaterThan(n("low") * 8);
  expect(n("ultra")).toBeGreaterThan(38000);
});
