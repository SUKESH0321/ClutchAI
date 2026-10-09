import * as THREE from "three";
import type { Circuit } from "../../lib/circuit";

/** Sample along either the main circuit or the pit lane: position, unit tangent, and widths. */
interface Sample { x: number; y: number; tx: number; ty: number }

const col = (hex: string) => new THREE.Color(hex);

function setGeometry(pos: number[], colors: number[] | null, idx: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  if (colors) g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * Horizontal strip between two lateral offsets (metres, positive = left of travel) along samples.
 * Map coords (x, y north) are converted to scene coords (x, h, -y).
 */
export function strip(
  s: Sample[], off0: (i: number) => number, off1: (i: number) => number, h: number,
  closed: boolean, color?: (i: number) => THREE.Color,
): THREE.BufferGeometry {
  const pos: number[] = [], cols: number[] = [], idx: number[] = [];
  const m = closed ? s.length + 1 : s.length;
  for (let k = 0; k < m; k++) {
    const i = k % s.length, p = s[i];
    const nx = -p.ty, ny = p.tx; // left normal (map coords)
    const a = off0(i), b = off1(i);
    pos.push(p.x + nx * a, h, -(p.y + ny * a), p.x + nx * b, h, -(p.y + ny * b));
    if (color) { const c = color(i); cols.push(c.r, c.g, c.b, c.r, c.g, c.b); }
    if (k > 0) { const v = (k - 1) * 2; idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2); }
  }
  return setGeometry(pos, color ? cols : null, idx);
}

/** Vertical wall along samples at a lateral offset. */
export function wall(
  s: Sample[], off: (i: number) => number, h0: number, h1: number, closed: boolean,
  color?: (i: number) => THREE.Color,
): THREE.BufferGeometry {
  const pos: number[] = [], cols: number[] = [], idx: number[] = [];
  const m = closed ? s.length + 1 : s.length;
  for (let k = 0; k < m; k++) {
    const i = k % s.length, p = s[i];
    const o = off(i);
    const x = p.x - p.ty * o, y = p.y + p.tx * o;
    pos.push(x, h0, -y, x, h1, -y);
    if (color) { const c = color(i); cols.push(c.r, c.g, c.b, c.r, c.g, c.b); }
    if (k > 0) { const v = (k - 1) * 2; idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2); }
  }
  return setGeometry(pos, color ? cols : null, idx);
}

export function mainSamples(c: Circuit): Sample[] {
  return Array.from({ length: c.n }, (_, i) => ({ x: c.x[i], y: c.y[i], tx: c.tx[i], ty: c.ty[i] }));
}
export function pitSamples(c: Circuit): Sample[] {
  return Array.from({ length: c.pit.x.length }, (_, i) => ({ x: c.pit.x[i], y: c.pit.y[i], tx: c.pit.tx[i], ty: c.pit.ty[i] }));
}

const RED = col("#d9232d"), WHITE = col("#f2f2f2");

export interface TrackGeometries {
  road: THREE.BufferGeometry;
  edgeL: THREE.BufferGeometry;
  edgeR: THREE.BufferGeometry;
  grass: THREE.BufferGeometry;
  kerbs: THREE.BufferGeometry;
  gravel: THREE.BufferGeometry;
  walls: THREE.BufferGeometry;
  pitLane: THREE.BufferGeometry;
  pitGlow: THREE.BufferGeometry;
  garageWall: THREE.BufferGeometry;
  garageRoof: THREE.BufferGeometry;
  pitWall: THREE.BufferGeometry;
  arrows: THREE.BufferGeometry;
  scGlow: THREE.BufferGeometry;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}

function merge(geoms: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [], cols: number[] = [], idx: number[] = [];
  let base = 0;
  let hasColor = true;
  for (const g of geoms) if (!g.getAttribute("color")) hasColor = false;
  for (const g of geoms) {
    const p = g.getAttribute("position"), cc = g.getAttribute("color"), ix = g.getIndex()!;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      if (hasColor && cc) cols.push(cc.getX(i), cc.getY(i), cc.getZ(i));
    }
    for (let i = 0; i < ix.count; i++) idx.push(ix.getX(i) + base);
    base += p.count;
  }
  return setGeometry(pos, hasColor ? cols : null, idx);
}

export function buildTrackGeometries(c: Circuit): TrackGeometries {
  const S = mainSamples(c);
  const hl = (i: number) => c.hl[i], hr = (i: number) => c.hr[i];
  const road = strip(S, (i) => -hr(i), (i) => hl(i), 0.05, true);
  const edgeL = strip(S, (i) => hl(i) - 0.5, (i) => hl(i) - 0.15, 0.07, true);
  const edgeR = strip(S, (i) => -hr(i) + 0.15, (i) => -hr(i) + 0.5, 0.07, true);
  const grass = strip(S, (i) => -(hr(i) + 55), (i) => hl(i) + 55, 0.0, true);

  // kerbs on the inside of every detected corner, red/white stripes; gravel + walls on the outside
  const kerbParts: THREE.BufferGeometry[] = [];
  const gravelParts: THREE.BufferGeometry[] = [];
  const wallParts: THREE.BufferGeometry[] = [];
  const ext = 6;
  for (const k of c.data.corners) {
    const len = ((k.end_index - k.start_index + c.n) % c.n) + 1 + ext * 2;
    const seg: Sample[] = [];
    const ids: number[] = [];
    for (let j = 0; j < len; j++) { const i = (k.start_index - ext + j + c.n) % c.n; ids.push(i); seg.push(S[i]); }
    const left = k.turn === "left";
    kerbParts.push(strip(
      seg,
      (j) => (left ? c.hl[ids[j]] : -(c.hr[ids[j]] + 1.7)),
      (j) => (left ? c.hl[ids[j]] + 1.7 : -c.hr[ids[j]]),
      0.09, false, (j) => (Math.floor(j / 2) % 2 === 0 ? RED : WHITE)));
    gravelParts.push(strip(
      seg,
      (j) => (left ? -(c.hr[ids[j]] + 3) : c.hl[ids[j]] + 3),
      (j) => (left ? -(c.hr[ids[j]] + 20) : c.hl[ids[j]] + 20),
      0.03, false));
    wallParts.push(wall(
      seg, (j) => (left ? -(c.hr[ids[j]] + 24) : c.hl[ids[j]] + 24), 0, 1.3, false,
      (j) => (Math.floor(j / 3) % 2 === 0 ? WHITE : RED)));
  }

  // pit lane
  const P = pitSamples(c);
  const pitLane = strip(P, () => -5, () => 5, 0.06, false);
  const pitGlow = strip(P, () => -4.5, () => 4.5, 0.12, false);
  const garageWall = wall(P, () => -17, 0, 6.5, false);
  const garageRoof = strip(P, () => -17, () => -31, 6.5, false);
  const pitWall = wall(P, () => 7, 0, 1.1, false, (j) => (Math.floor(j / 2) % 2 === 0 ? WHITE : col("#d9c4c7")));

  // direction arrows every ~320 m
  const apos: number[] = [], aidx: number[] = [];
  const every = Math.round(320 / c.step);
  for (let i = every / 2; i < c.n; i += every) {
    const p = S[Math.floor(i)];
    const f = (a: number, b: number) => [p.x + p.tx * a - p.ty * b, 0.1, -(p.y + p.ty * a + p.tx * b)];
    const base = apos.length / 3;
    apos.push(...f(9, 0), ...f(-6, 5.2), ...f(-2.5, 0), ...f(-6, -5.2));
    aidx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const arrows = setGeometry(apos, null, aidx);

  const scGlow = merge([strip(S, (i) => hl(i) + 0.4, (i) => hl(i) + 1.6, 0.11, true),
    strip(S, (i) => -hr(i) - 1.6, (i) => -hr(i) - 0.4, 0.11, true)]);

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < c.n; i++) {
    minX = Math.min(minX, c.x[i]); maxX = Math.max(maxX, c.x[i]);
    minZ = Math.min(minZ, -c.y[i]); maxZ = Math.max(maxZ, -c.y[i]);
  }
  return {
    road, edgeL, edgeR, grass, kerbs: merge(kerbParts), gravel: merge(gravelParts), walls: merge(wallParts),
    pitLane, pitGlow, garageWall, garageRoof, pitWall, arrows, scGlow, bounds: { minX, maxX, minZ, maxZ },
  };
}
