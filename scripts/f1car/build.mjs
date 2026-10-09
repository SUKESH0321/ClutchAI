// Converts the user-supplied F1 car (FBX -> GLB via FBX2glTF) into a game-ready, recolourable model.
// usage: node build.mjs <in.glb> <outDir>
import { Document, NodeIO } from "@gltf-transform/core";
import { MeshoptSimplifier } from "meshoptimizer";
import fs from "node:fs";
await MeshoptSimplifier.ready;
const [, , IN, OUT] = process.argv;
const src = await new NodeIO().read(IN);
const S = 30.48 * 0.03, K = 1.17, YM = 2.76, ZMIN = -0.325; // source scale, target scale, mid-wheelbase, ground
const FRONT = new Set(["Body387", "Body388", "Body389", "Body390"]);
const REAR = new Set(["Body391", "Body392", "Body393"]);
const TYRE = new Set(["Body387", "Body391"]);
const PAINT = new Set((process.env.PAINT || "FRONT NOSE,Body203,Body379,Body378").split(","));

// ---- gather triangle soups per class -----------------------------------------------------------------------
const cls = {};
const add = (key, p, n, idx, xsel) => {
  const c = (cls[key] ??= { p: [], n: [], tris: 0 });
  for (let t = 0; t < idx.length; t += 3) {
    if (xsel) {
      const cx = (p[idx[t] * 3] + p[idx[t + 1] * 3] + p[idx[t + 2] * 3]) / 3;
      if (!xsel(cx)) continue;
    }
    for (let k = 0; k < 3; k++) {
      const i = idx[t + k];
      c.p.push(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
      c.n.push(n[i * 3], n[i * 3 + 1], n[i * 3 + 2]);
    }
    c.tris++;
  }
};
let dropped = 0;
for (const node of src.getRoot().listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  const name = node.getName();
  for (const prim of mesh.listPrimitives()) {
    const P = prim.getAttribute("POSITION"), N = prim.getAttribute("NORMAL"), I = prim.getIndices().getArray();
    const pa = P.getArray(), na = N ? N.getArray() : new Float32Array(pa.length);
    const mn = P.getMin([]), mx = P.getMax([]);
    const ext = Math.max(...[0, 1, 2].map((i) => (mx[i] - mn[i]) * S));
    const wheel = FRONT.has(name) || REAR.has(name);
    if (!wheel && ext < 0.1) { dropped += I.length / 3; continue; }
    if (wheel) {
      const axle = FRONT.has(name) ? "f" : "r";
      for (const side of ["l", "r"]) add(`w_${axle}${side}_${TYRE.has(name) ? "tyre" : "rim"}`, pa, na, I, (x) => (side === "l" ? x >= 0 : x < 0));
    } else add(PAINT.has(name) ? "paint" : "carbon", pa, na, I);
  }
}
console.log("dropped tiny tris", dropped, JSON.stringify(Object.fromEntries(Object.entries(cls).map(([k, v]) => [k, v.tris]))));

// ---- weld, simplify, smooth normals -------------------------------------------------------------------------
function processGroup(c, targetTris, err = 0.04) {
  const map = new Map(), pos = [], idx = new Uint32Array(c.tris * 3);
  for (let v = 0; v < c.tris * 3; v++) {
    const x = c.p[v * 3], y = c.p[v * 3 + 1], z = c.p[v * 3 + 2];
    const key = Math.round(x * 2e4) + "," + Math.round(y * 2e4) + "," + Math.round(z * 2e4);
    let id = map.get(key);
    if (id === undefined) { id = pos.length / 3; map.set(key, id); pos.push(x, y, z); }
    idx[v] = id;
  }
  const P = new Float32Array(pos);
  const keep = [];
  for (let t = 0; t < idx.length; t += 3) if (idx[t] !== idx[t + 1] && idx[t + 1] !== idx[t + 2] && idx[t] !== idx[t + 2]) keep.push(idx[t], idx[t + 1], idx[t + 2]);
  let I = new Uint32Array(keep);
  if (I.length / 3 > targetTris) {
    const [ni] = MeshoptSimplifier.simplify(I, P, 3, targetTris * 3, err, []);
    I = ni;
  }
  const re = new Map(), P2 = [];
  const I2 = new Uint32Array(I.length);
  for (let i = 0; i < I.length; i++) {
    let r = re.get(I[i]);
    if (r === undefined) { r = P2.length / 3; re.set(I[i], r); P2.push(P[I[i] * 3], P[I[i] * 3 + 1], P[I[i] * 3 + 2]); }
    I2[i] = r;
  }
  const Pf = new Float32Array(P2), Nn = new Float32Array(Pf.length);
  for (let t = 0; t < I2.length; t += 3) {
    const a = I2[t] * 3, b = I2[t + 1] * 3, d = I2[t + 2] * 3;
    const ux = Pf[b] - Pf[a], uy = Pf[b + 1] - Pf[a + 1], uz = Pf[b + 2] - Pf[a + 2];
    const vx = Pf[d] - Pf[a], vy = Pf[d + 1] - Pf[a + 1], vz = Pf[d + 2] - Pf[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const o of [a, b, d]) { Nn[o] += nx; Nn[o + 1] += ny; Nn[o + 2] += nz; }
  }
  for (let i = 0; i < Nn.length; i += 3) { const l = Math.hypot(Nn[i], Nn[i + 1], Nn[i + 2]) || 1; Nn[i] /= l; Nn[i + 1] /= l; Nn[i + 2] /= l; }
  return { P: Pf, N: Nn, I: I2 };
}
// source (x, y forward-negative, z up) -> scene (x, up, forward)
const toScene = (P) => {
  const o = new Float32Array(P.length);
  for (let i = 0; i < P.length; i += 3) { o[i] = P[i] * S * K; o[i + 1] = (P[i + 2] * S - ZMIN) * K; o[i + 2] = -(P[i + 1] * S - YM) * K; }
  return o;
};
const nScene = (N) => {
  const o = new Float32Array(N.length);
  for (let i = 0; i < N.length; i += 3) { o[i] = N[i]; o[i + 1] = N[i + 2]; o[i + 2] = -N[i + 1]; }
  return o;
};

function build(budget) {
  const doc = new Document();
  const buf = doc.createBuffer();
  const mat = (n, c, m, r) => doc.createMaterial(n).setBaseColorFactor(c).setMetallicFactor(m).setRoughnessFactor(r);
  const mPaint = mat("paint", [1, 1, 1, 1], 0.15, 0.35), mCarbon = mat("carbon", [0.07, 0.07, 0.08, 1], 0.5, 0.4), mRubber = mat("rubber", [0.05, 0.05, 0.05, 1], 0, 0.85);
  const mk = (r, material, name, shift = [0, 0, 0]) => {
    const P = toScene(r.P);
    for (let i = 0; i < P.length; i += 3) { P[i] -= shift[0]; P[i + 1] -= shift[1]; P[i + 2] -= shift[2]; }
    const prim = doc.createPrimitive()
      .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(P).setBuffer(buf))
      .setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setArray(nScene(r.N)).setBuffer(buf))
      .setIndices(doc.createAccessor().setType("SCALAR").setArray(P.length / 3 > 65000 ? r.I : new Uint16Array(r.I)).setBuffer(buf))
      .setMaterial(material);
    return doc.createMesh(name).addPrimitive(prim);
  };
  const scene = doc.createScene("car");
  const root = doc.createNode("car");
  scene.addChild(root);
  const body = doc.createNode("body");
  root.addChild(body);
  const stats = {};
  const rp = processGroup(cls.paint, budget.paint);
  stats.paint = rp.I.length / 3;
  body.addChild(doc.createNode("paint").setMesh(mk(rp, mPaint, "paint")));
  const rc = processGroup(cls.carbon, budget.carbon);
  stats.carbon = rc.I.length / 3;
  body.addChild(doc.createNode("carbon").setMesh(mk(rc, mCarbon, "carbon")));
  for (const [axle, nm] of [["f", "front"], ["r", "back"]]) {
    for (const [side, sn] of [["l", "left"], ["r", "right"]]) {
      const tyre = processGroup(cls[`w_${axle}${side}_tyre`], budget.tyre), rim = processGroup(cls[`w_${axle}${side}_rim`], budget.rim);
      const T = toScene(tyre.P);
      const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
      for (let i = 0; i < T.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], T[i + k]); hi[k] = Math.max(hi[k], T[i + k]); }
      const ctr = [0, 1, 2].map((k) => (lo[k] + hi[k]) / 2);
      const wn = doc.createNode(`wheel-${nm}-${sn}`).setTranslation(ctr);
      root.addChild(wn);
      wn.addChild(doc.createNode("tyre").setMesh(mk(tyre, mRubber, "tyre", ctr)));
      wn.addChild(doc.createNode("rim").setMesh(mk(rim, mCarbon, "rim", ctr)));
      stats[`${nm}-${sn}`] = { tris: (tyre.I.length + rim.I.length) / 3, ctr: ctr.map((v) => +v.toFixed(3)), radius: +((hi[1] - lo[1]) / 2).toFixed(3), width: +(hi[0] - lo[0]).toFixed(3) };
    }
  }
  return { doc, stats };
}
fs.mkdirSync(OUT, { recursive: true });
const variants = {
  hi: { paint: 26000, carbon: 24000, tyre: 2600, rim: 1800 },
  lo: { paint: 1800, carbon: 1500, tyre: 280, rim: 160 },
};
for (const [name, b] of Object.entries(variants)) {
  const { doc, stats } = build(b);
  await new NodeIO().write(`${OUT}/f1_${name}.glb`, doc);
  console.log(name, JSON.stringify(stats), (fs.statSync(`${OUT}/f1_${name}.glb`).size / 1e6).toFixed(2), "MB");
}
