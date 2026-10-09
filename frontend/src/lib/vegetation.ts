import type { Circuit } from "./circuit";

/**
 * Vegetation planning: where trees and bushes go around a circuit. Pure data (no three.js), so it is unit-tested.
 *
 * The plan is a density field, not uniform scatter:
 *  - forest clusters from two layers of value noise (dense stands separated by thin meadow)
 *  - a safety clearance from the track EDGE (centreline distance minus the local half-width), larger for trees than bushes
 *  - exclusions: pit complex, grandstands, open sight-line zones on the outside of corners (trees only)
 *  - layering: small trees and bushes close to the circuit, tall trees further out, sparser far away
 * The density is normalised so the requested instance count is met, then instances are jittered inside their cells.
 */
export interface VegInstance { x: number; y: number; z: number; rot: number; h: number; tone: number; species: number }
export interface Exclusion { x: number; z: number; r: number }      // scene coordinates (x, z = -north)
export interface VegPlan { trees: VegInstance[]; bushes: VegInstance[] }

/** species index ranges (indices into the model lists in Vegetation.tsx) */
export const BROADLEAF = 7, CONIFER = 6, BUSH = 5;

export const TREE_CLEARANCE_M = 46;     // from the track edge: beyond runoff, gravel, barriers, fences and marshal posts
export const BUSH_CLEARANCE_M = 34;
export const PIT_CLEARANCE_M = 85;      // from any point of the pit lane (garages stand 19 m to the side)
export const CORNER_OPEN_R = 90;        // open sight-line zone on the outside of each corner

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash2 = (ix: number, iz: number, s: number) => {
  const v = Math.sin(ix * 127.1 + iz * 311.7 + s * 74.7) * 43758.5453;
  return v - Math.floor(v);
};
function vnoise(x: number, z: number, s: number) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, s), b = hash2(ix + 1, iz, s), c = hash2(ix, iz + 1, s), d = hash2(ix + 1, iz + 1, s);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}
const fbm = (x: number, z: number, s: number) => 0.58 * vnoise(x, z, s) + 0.28 * vnoise(x * 2.1, z * 2.1, s + 1) + 0.14 * vnoise(x * 4.3, z * 4.3, s + 2);
const smooth = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

/** distance from the track EDGE (m, negative on the road) at a scene position */
export function edgeDistance(c: Circuit, x: number, z: number): number {
  const mx = x, my = -z;
  const { d, i } = c.nearest(mx, my);
  const left = -c.ty[i] * (mx - c.x[i]) + c.tx[i] * (my - c.y[i]) > 0;
  return d - (left ? c.hl[i] : c.hr[i]);
}

export function pitDistance(c: Circuit, x: number, z: number): number {
  const mx = x, my = -z;
  let best = Infinity;
  for (let i = 0; i < c.pit.x.length; i++) best = Math.min(best, Math.hypot(mx - c.pit.x[i], my - c.pit.y[i]));
  return best;
}

/** open sight-line circles on the outside of each corner (scene coordinates) */
export function cornerOpenZones(c: Circuit): Exclusion[] {
  return c.data.corners.map((k) => {
    const i = k.index, side = k.turn === "left" ? -1 : 1;             // outside of the bend
    const nx = -c.ty[i] * side, ny = c.tx[i] * side;
    const off = (side > 0 ? c.hl[i] : c.hr[i]) + 55;
    return { x: c.x[i] + nx * off, z: -(c.y[i] + ny * off), r: CORNER_OPEN_R };
  });
}

export function planVegetation(
  c: Circuit, heightAt: (x: number, z: number) => number,
  opts: { trees: number; bushes: number; exclusions: Exclusion[]; seed?: number; margin?: number; half?: number },
): VegPlan {
  const seed = opts.seed ?? 11, CELL = 24, margin = opts.margin ?? 1500, half = (opts.half ?? 3400) - 40;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < c.n; i++) {
    minX = Math.min(minX, c.x[i]); maxX = Math.max(maxX, c.x[i]);
    minZ = Math.min(minZ, -c.y[i]); maxZ = Math.max(maxZ, -c.y[i]);
  }
  const x0 = Math.max(-half, Math.floor((minX - margin) / CELL) * CELL), x1 = Math.min(half, maxX + margin);
  const z0 = Math.max(-half, Math.floor((minZ - margin) / CELL) * CELL), z1 = Math.min(half, maxZ + margin);
  const nx = Math.ceil((x1 - x0) / CELL), nz = Math.ceil((z1 - z0) / CELL);
  const open = cornerOpenZones(c);
  const excl = opts.exclusions;

  const rhoT = new Float32Array(nx * nz), rhoB = new Float32Array(nx * nz), edge = new Float32Array(nx * nz);
  let totT = 0, totB = 0;
  for (let gz = 0; gz < nz; gz++) {
    for (let gx = 0; gx < nx; gx++) {
      const x = x0 + (gx + 0.5) * CELL, z = z0 + (gz + 0.5) * CELL, k = gz * nx + gx;
      const e = edgeDistance(c, x, z);
      edge[k] = e;
      if (e < BUSH_CLEARANCE_M - CELL * 0.5) continue;
      const pd = e < 400 ? pitDistance(c, x, z) : Infinity;
      let blockT = e < TREE_CLEARANCE_M || pd < PIT_CLEARANCE_M, blockB = pd < 55;
      for (const ex of excl) {
        const d = Math.hypot(x - ex.x, z - ex.z);
        if (d < ex.r) blockT = true;
        if (d < ex.r * 0.45) blockB = true;
      }
      if (!blockT) for (const o of open) if (Math.hypot(x - o.x, z - o.z) < o.r) { blockT = true; break; }
      const F = fbm(x / 340 + seed, z / 340 - seed, 3);
      const forest = smooth(0.4, 0.55, F);
      if (!blockT) {
        const wd = smooth(TREE_CLEARANCE_M, 130, e) * (1 - 0.82 * smooth(450, 1500, e));
        const r = (forest + (1 - forest) * 0.1) * wd;
        rhoT[k] = r; totT += r;
      }
      if (!blockB) {
        const clump = smooth(0.35, 0.62, fbm(x / 70 + seed, z / 70, 7));
        const wb = smooth(BUSH_CLEARANCE_M, 56, e) * (1 - smooth(110, 520, e));
        const r = wb * (0.25 + 0.75 * clump) * (0.45 + 0.55 * forest);
        rhoB[k] = r; totB += r;
      }
    }
  }

  const rnd = mulberry(seed * 9973 + 17);
  const trees: VegInstance[] = [], bushes: VegInstance[] = [];
  const sT = totT > 0 ? opts.trees / totT : 0, sB = totB > 0 ? opts.bushes / totB : 0;
  const clear = (x: number, z: number, tree: boolean) => {
    const e = edgeDistance(c, x, z);
    if (e < (tree ? TREE_CLEARANCE_M : BUSH_CLEARANCE_M)) return false;
    return true;
  };
  for (let gz = 0; gz < nz; gz++) {
    for (let gx = 0; gx < nx; gx++) {
      const k = gz * nx + gx, e = edge[k];
      const nT = rhoT[k] * sT, nB = rhoB[k] * sB;
      let cT = Math.floor(nT) + (rnd() < nT - Math.floor(nT) ? 1 : 0);
      let cB = Math.floor(nB) + (rnd() < nB - Math.floor(nB) ? 1 : 0);
      const cx = x0 + gx * CELL, cz = z0 + gz * CELL;
      const type = fbm((cx + CELL / 2) / 820 - seed, (cz + CELL / 2) / 820, 11);   // large-scale conifer vs broadleaf regions
      while (cT-- > 0) {
        const x = cx + rnd() * CELL, z = cz + rnd() * CELL;
        if (e < TREE_CLEARANCE_M + CELL && !clear(x, z, true)) continue;
        const conifer = rnd() < smooth(0.34, 0.66, type) * 0.85 + 0.08;
        const layer = smooth(50, 190, e);                              // small trees near the circuit, tall trees behind
        const base = conifer ? 11 + rnd() * 9 : 9 + rnd() * 8;
        const h = base * (0.5 + 0.5 * layer) * (0.92 + 0.16 * rnd());
        const species = conifer ? BROADLEAF + Math.floor(rnd() * CONIFER) : Math.floor(rnd() * BROADLEAF);
        trees.push({ x, y: heightAt(x, z) - 0.15, z, rot: rnd() * Math.PI * 2, h, tone: 0.82 + 0.3 * rnd(), species });
      }
      while (cB-- > 0) {
        const x = cx + rnd() * CELL, z = cz + rnd() * CELL;
        if (e < BUSH_CLEARANCE_M + CELL && !clear(x, z, false)) continue;
        const h = 1.1 + rnd() * rnd() * 3.2;
        bushes.push({ x, y: heightAt(x, z) - 0.05, z, rot: rnd() * Math.PI * 2, h, tone: 0.8 + 0.35 * rnd(), species: Math.floor(rnd() * BUSH) });
      }
    }
  }
  return { trees, bushes };
}
