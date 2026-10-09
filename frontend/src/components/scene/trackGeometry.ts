import * as THREE from "three";
import type { Circuit } from "../../lib/circuit";

/** Sample along either the main circuit or the pit lane: position, unit tangent. */
interface Sample { x: number; y: number; tx: number; ty: number }

function setGeometry(pos: number[], uv: number[], colors: number[] | null, idx: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  if (colors) g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * Horizontal strip between two lateral offsets (metres, positive = left of travel) along samples.
 * Map coords (x, y north) -> scene coords (x, h, -y). UVs are in tile units: u = lateral/tile, v = distance/tile.
 * For closed loops the tile length is adjusted so the texture repeats a whole number of times (no seam at the line).
 */
export function strip(
  s: Sample[], off0: (i: number) => number, off1: (i: number) => number, h: number,
  closed: boolean, color?: (i: number) => THREE.Color, tile = 7,
): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], cols: number[] = [], idx: number[] = [];
  const m = closed ? s.length + 1 : s.length;
  const dists: number[] = [0];
  for (let k = 1; k < m; k++) {
    const a = s[(k - 1) % s.length], b = s[k % s.length];
    dists.push(dists[k - 1] + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const total = dists[m - 1];
  const t = closed ? total / Math.max(1, Math.round(total / tile)) : tile;
  for (let k = 0; k < m; k++) {
    const i = k % s.length, p = s[i];
    const nx = -p.ty, ny = p.tx;
    const a = off0(i), b = off1(i);
    pos.push(p.x + nx * a, h, -(p.y + ny * a), p.x + nx * b, h, -(p.y + ny * b));
    uv.push(a / tile, dists[k] / t, b / tile, dists[k] / t);
    if (color) { const c = color(i); cols.push(c.r, c.g, c.b, c.r, c.g, c.b); }
    if (k > 0) { const v = (k - 1) * 2; idx.push(v, v + 2, v + 1, v + 1, v + 2, v + 3); }
  }
  return setGeometry(pos, uv, color ? cols : null, idx);
}

export function mainSamples(c: Circuit): Sample[] {
  return Array.from({ length: c.n }, (_, i) => ({ x: c.x[i], y: c.y[i], tx: c.tx[i], ty: c.ty[i] }));
}
export function pitSamples(c: Circuit): Sample[] {
  return Array.from({ length: c.pit.x.length }, (_, i) => ({ x: c.pit.x[i], y: c.pit.y[i], tx: c.pit.tx[i], ty: c.pit.ty[i] }));
}

function merge(geoms: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [], cols: number[] = [];
  let base = 0;
  const hasColor = geoms.every((g) => !!g.getAttribute("color"));
  for (const g of geoms) {
    const p = g.getAttribute("position"), u = g.getAttribute("uv"), cc = g.getAttribute("color"), ix = g.getIndex()!;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      uv.push(u.getX(i), u.getY(i));
      if (hasColor && cc) cols.push(cc.getX(i), cc.getY(i), cc.getZ(i));
    }
    for (let i = 0; i < ix.count; i++) idx.push(ix.getX(i) + base);
    base += p.count;
  }
  return setGeometry(pos, uv, hasColor ? cols : null, idx);
}

/** Transform for an object standing at a track pose, offset laterally, with +X along travel. */
export function poseMatrix(p: { x: number; y: number; tx: number; ty: number }, lateral: number, height: number, yawExtra = 0): THREE.Matrix4 {
  const nx = -p.ty, ny = p.tx;
  const m = new THREE.Matrix4();
  m.makeRotationY(Math.atan2(p.ty, p.tx) + yawExtra);
  m.setPosition(p.x + nx * lateral, height, -(p.y + ny * lateral));
  return m;
}

export interface CornerZone { index: number; ids: number[]; left: boolean; radius: number }

export interface TrackGeometries {
  road: THREE.BufferGeometry;
  edgeL: THREE.BufferGeometry;
  edgeR: THREE.BufferGeometry;
  kerbs: THREE.BufferGeometry;
  runoff: THREE.BufferGeometry;      // tarmac run-off on the outside of corners
  gravel: THREE.BufferGeometry;
  pitLane: THREE.BufferGeometry;
  pitGlow: THREE.BufferGeometry;
  pitLine: THREE.BufferGeometry;
  scGlow: THREE.BufferGeometry;
  arrows: THREE.BufferGeometry;
  corners: CornerZone[];
  barriers: THREE.Matrix4[];         // Jersey concrete barriers (instanced)
  pitWall: THREE.Matrix4[];
  tyreWallSites: { pose: ReturnType<Circuit["pointAt"]>; left: boolean; lateral: number }[];
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}

export function buildTrackGeometries(c: Circuit): TrackGeometries {
  const S = mainSamples(c);
  const hl = (i: number) => c.hl[i], hr = (i: number) => c.hr[i];
  const road = strip(S, (i) => -hr(i), (i) => hl(i), 0.05, true, undefined, 6);
  const edgeL = strip(S, (i) => hl(i) - 0.5, (i) => hl(i) - 0.15, 0.065, true);
  const edgeR = strip(S, (i) => -hr(i) + 0.15, (i) => -hr(i) + 0.5, 0.065, true);

  const corners: CornerZone[] = [];
  const kerbParts: THREE.BufferGeometry[] = [];
  const runoffParts: THREE.BufferGeometry[] = [];
  const gravelParts: THREE.BufferGeometry[] = [];
  const barriers: THREE.Matrix4[] = [];
  const ext = 6;
  for (const k of c.data.corners) {
    const len = ((k.end_index - k.start_index + c.n) % c.n) + 1 + ext * 2;
    const ids: number[] = [], seg: Sample[] = [];
    for (let j = 0; j < len; j++) { const i = (k.start_index - ext + j + c.n) % c.n; ids.push(i); seg.push(S[i]); }
    const left = k.turn === "left";
    corners.push({ index: k.index, ids, left, radius: k.radius_m });
    // kerb on the inside, textured red/white stripes (UV along the road)
    kerbParts.push(strip(seg,
      (j) => (left ? hl(ids[j]) : -(hr(ids[j]) + 1.7)),
      (j) => (left ? hl(ids[j]) + 1.7 : -hr(ids[j])),
      0.085, false, undefined, 1.2));
    // tarmac run-off then gravel on the outside
    runoffParts.push(strip(seg,
      (j) => (left ? -(hr(ids[j]) + 9) : hl(ids[j]) + 0.2),
      (j) => (left ? -(hr(ids[j]) + 0.2) : hl(ids[j]) + 9),
      0.03, false, undefined, 7));
    gravelParts.push(strip(seg,
      (j) => (left ? -(hr(ids[j]) + 22) : hl(ids[j]) + 9),
      (j) => (left ? -(hr(ids[j]) + 9) : hl(ids[j]) + 22),
      0.025, false, undefined, 5));
    // concrete barrier behind the gravel, one section every 2 m along the outside of the corner
    const f0 = ids[0] / c.n, f1 = (ids[0] + len) / c.n;
    const lenM = ((f1 - f0 + 1) % 1) * c.length || len * c.step;
    for (let d = 0; d < lenM; d += 2.0) {
      const p = c.pointAt(((f0 + d / c.length) % 1 + 1) % 1);
      const i = Math.round(((f0 + d / c.length) % 1) * c.n) % c.n;
      barriers.push(poseMatrix(p, left ? -(hr(i) + 24.5) : hl(i) + 24.5, 0));
    }
  }

  // pit lane surface, fast-lane line and highlight
  const P = pitSamples(c);
  const pitLane = strip(P, () => -5, () => 5, 0.055, false, undefined, 5);
  const pitGlow = strip(P, () => -4.5, () => 4.5, 0.12, false);
  const pitLine = merge([
    strip(P, () => 3.4, () => 3.7, 0.075, false),
    strip(P, () => -0.15, () => 0.15, 0.075, false),
  ]);
  // low wall between the track and the pit lane (instanced barriers along the lane's track side)
  const pitWall: THREE.Matrix4[] = [];
  for (let d = 0; d < c.pit.length; d += 2.0) {
    const p = c.pitAt(d);
    pitWall.push(poseMatrix(p, 7.2, 0));
  }

  // chevrons
  const apos: number[] = [], auv: number[] = [], aidx: number[] = [];
  const every = Math.round(320 / c.step);
  for (let i = every / 2; i < c.n; i += every) {
    const p = S[Math.floor(i)];
    const f = (a: number, b: number) => [p.x + p.tx * a - p.ty * b, 0.09, -(p.y + p.ty * a + p.tx * b)];
    const base = apos.length / 3;
    apos.push(...f(9, 0), ...f(-6, 5.2), ...f(-2.5, 0), ...f(-6, -5.2));
    auv.push(0, 0, 0, 0, 0, 0, 0, 0);
    aidx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const arrows = setGeometry(apos, auv, null, aidx);

  const scGlow = merge([strip(S, (i) => hl(i) + 0.4, (i) => hl(i) + 1.6, 0.11, true),
    strip(S, (i) => -hr(i) - 1.6, (i) => -hr(i) - 0.4, 0.11, true)]);

  // tyre-wall sites: the fastest corners (largest radius) first, on the outside, in front of the barrier
  const ranked = [...corners].sort((a, b) => b.radius - a.radius);
  const tyreWallSites = ranked.slice(0, 12).map((z) => {
    const mid = z.ids[Math.floor(z.ids.length / 2)];
    return { pose: c.pointAt(mid / c.n), left: z.left, lateral: z.left ? -(c.hr[mid] + 20.5) : c.hl[mid] + 20.5 };
  });

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < c.n; i++) {
    minX = Math.min(minX, c.x[i]); maxX = Math.max(maxX, c.x[i]);
    minZ = Math.min(minZ, -c.y[i]); maxZ = Math.max(maxZ, -c.y[i]);
  }
  return {
    road, edgeL, edgeR, kerbs: merge(kerbParts), runoff: merge(runoffParts), gravel: merge(gravelParts),
    pitLane, pitGlow, pitLine, scGlow, arrows, corners, barriers, pitWall, tyreWallSites,
    bounds: { minX, maxX, minZ, maxZ },
  };
}

/** Low-poly Jersey concrete barrier, 2 m long, extruded along +X. UVs are in metres. */
export function jerseyBarrierGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const pts: [number, number][] = [[-0.3, 0], [0.3, 0], [0.3, 0.15], [0.14, 0.5], [0.12, 0.9], [-0.12, 0.9], [-0.14, 0.5], [-0.3, 0.15]];
  shape.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: 2.0, bevelEnabled: false });
  g.translate(0, 0, -1.0);          // centre the extrusion
  g.rotateY(Math.PI / 2);           // extrusion axis (z) -> x
  g.computeVertexNormals();
  return g;
}

/** Kerb stripe texture (red/white), drawn once; tiles every 1.2 m along the kerb. */
export function kerbTexture(): THREE.CanvasTexture {
  const cv = document.createElement("canvas");
  cv.width = 64; cv.height = 128;
  const g = cv.getContext("2d")!;
  g.fillStyle = "#e9e9e6"; g.fillRect(0, 0, 64, 128);
  g.fillStyle = "#c8161f"; g.fillRect(0, 0, 64, 64);
  const img = g.getImageData(0, 0, 64, 128);
  for (let i = 0; i < img.data.length; i += 4) {          // subtle paint wear / grit
    const n = (Math.random() - 0.5) * 26;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
