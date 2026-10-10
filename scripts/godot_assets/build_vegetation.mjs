// Optimises the user-supplied vegetation GLBs for the Godot client.
//   node build_vegetation.mjs <assets/trees/realistic_trees_collection.glb> <assets/grass/grass.glb> <outDir>
// Trees: one GLB per tree (branches + leaves), world transforms baked, base on y=0, trunk at the origin, scaled to a real
//        height, textures resized to 512 px, leaf cards switched from BLEND to MASK (alpha scissor), geometry simplified.
// Grass: the 4 clump meshes (~50k triangles each) simplified to a few hundred triangles.
import { Document, NodeIO } from "@gltf-transform/core";
import { KHRONOS_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";
import fs from "node:fs";
await MeshoptSimplifier.ready;
const [, , TREES, GRASS, OUT] = process.argv;
fs.mkdirSync(OUT, { recursive: true });
const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS);

function collect(doc) {
  const out = [];
  for (const n of doc.getRoot().listNodes()) {
    const mesh = n.getMesh();
    if (!mesh) continue;
    const m = n.getWorldMatrix();
    for (const p of mesh.listPrimitives()) {
      const P = p.getAttribute("POSITION").getArray(), N = p.getAttribute("NORMAL")?.getArray(), U = p.getAttribute("TEXCOORD_0")?.getArray();
      const pos = new Float32Array(P.length), nor = new Float32Array(P.length);
      for (let i = 0; i < P.length; i += 3) {
        const x = P[i], y = P[i + 1], z = P[i + 2];
        pos[i] = m[0] * x + m[4] * y + m[8] * z + m[12];
        pos[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
        pos[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
        if (N) {
          const nx = N[i], ny = N[i + 1], nz = N[i + 2];
          const a = m[0] * nx + m[4] * ny + m[8] * nz, b = m[1] * nx + m[5] * ny + m[9] * nz, c = m[2] * nx + m[6] * ny + m[10] * nz;
          const l = Math.hypot(a, b, c) || 1; nor[i] = a / l; nor[i + 1] = b / l; nor[i + 2] = c / l;
        }
      }
      out.push({ name: n.getName(), pos, nor: N ? nor : null, uv: U ? Float32Array.from(U) : null, idx: Uint32Array.from(p.getIndices().getArray()), mat: p.getMaterial() });
    }
  }
  return out;
}

function simplify(g, targetTris, err) {
  let idx = g.idx;
  if (idx.length / 3 > targetTris) {
    const flags = [];
    if (g.uv) [idx] = MeshoptSimplifier.simplifyWithAttributes(idx, g.pos, 3, g.uv, 2, [1, 1], null, targetTris * 3, err, flags);
    else [idx] = MeshoptSimplifier.simplify(idx, g.pos, 3, targetTris * 3, err, flags);
  }
  // compact vertices
  const map = new Map(), P = [], N = [], U = [], I = new Uint32Array(idx.length);
  for (let i = 0; i < idx.length; i++) {
    let r = map.get(idx[i]);
    if (r === undefined) {
      r = P.length / 3; map.set(idx[i], r); const v = idx[i];
      P.push(g.pos[v * 3], g.pos[v * 3 + 1], g.pos[v * 3 + 2]);
      if (g.nor) N.push(g.nor[v * 3], g.nor[v * 3 + 1], g.nor[v * 3 + 2]);
      if (g.uv) U.push(g.uv[v * 2], g.uv[v * 2 + 1]);
    }
    I[i] = r;
  }
  return { pos: Float32Array.from(P), nor: g.nor ? Float32Array.from(N) : null, uv: g.uv ? Float32Array.from(U) : null, idx: I };
}

const texCache = new Map();
async function convertTexture(out, srcTex, alpha) {
  if (!srcTex) return null;
  const key = srcTex;
  if (texCache.has(key)) return texCache.get(key);
  const img = Buffer.from(srcTex.getImage());
  const buf = alpha ? await sharp(img).resize(512, 512, { fit: "fill" }).png({ compressionLevel: 9, palette: false }).toBuffer()
                    : await sharp(img).resize(512, 512, { fit: "fill" }).jpeg({ quality: 82 }).toBuffer();
  const t = out.createTexture(srcTex.getName() || "tex").setImage(new Uint8Array(buf)).setMimeType(alpha ? "image/png" : "image/jpeg");
  texCache.set(key, t);
  return t;
}

// ------------------------------------------------------------------------------------------------------ trees
const tdoc = await io.read(TREES);
const prims = collect(tdoc);
const groups = new Map();                      // "Tree EZTree0.Large_branches_0" -> tree key "EZTree0.Large"
for (const p of prims) {
  const key = p.name.replace(/^Tree /, "").replace(/_(branches|leaves)[^_]*_0$/, "").replace(/\.?\d+$/, (m) => m);
  const k = key.replace(/_(branches|leaves).*$/, "");
  (groups.get(k) ?? groups.set(k, []).get(k)).push(p);
}
const HEIGHT = { Large: 22, Medium: 13, Bush: 3.4 };
const manifest = [];
let ti = 0;
for (const [key, list] of groups) {
  const kind = /Bush/.test(key) ? "Bush" : /Large/.test(key) ? "Large" : "Medium";
  // bounds over all parts
  let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (const g of list) for (let i = 0; i < g.pos.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], g.pos[i + k]); mx[k] = Math.max(mx[k], g.pos[i + k]); }
  const s = HEIGHT[kind] / (mx[1] - mn[1]);
  const cx = (mn[0] + mx[0]) / 2, cz = (mn[2] + mx[2]) / 2;
  const out = new Document(); const buf = out.createBuffer();
  const scene = out.createScene("tree"); const node = out.createNode(`tree_${String(ti).padStart(2, "0")}`); scene.addChild(node);
  const mesh = out.createMesh("tree"); node.setMesh(mesh);
  let tris = 0;
  for (const g of list) {
    const leaves = g.mat.getAlphaMode() === "BLEND";
    for (let i = 0; i < g.pos.length; i += 3) { g.pos[i] = (g.pos[i] - cx) * s; g.pos[i + 1] = (g.pos[i + 1] - mn[1]) * s; g.pos[i + 2] = (g.pos[i + 2] - cz) * s; }
    const r = simplify(g, leaves ? 1700 : 900, leaves ? 0.06 : 0.04);
    const mat = out.createMaterial(g.mat.getName()).setBaseColorFactor(g.mat.getBaseColorFactor()).setDoubleSided(true).setRoughnessFactor(0.9).setMetallicFactor(0);
    if (leaves) mat.setAlphaMode("MASK").setAlphaCutoff(0.5);
    const tex = await convertTexture(out, g.mat.getBaseColorTexture(), leaves);
    if (tex) mat.setBaseColorTexture(tex);
    const prim = out.createPrimitive().setMaterial(mat)
      .setAttribute("POSITION", out.createAccessor().setType("VEC3").setArray(r.pos).setBuffer(buf))
      .setIndices(out.createAccessor().setType("SCALAR").setArray(r.pos.length / 3 > 65000 ? r.idx : new Uint16Array(r.idx)).setBuffer(buf));
    if (r.nor) prim.setAttribute("NORMAL", out.createAccessor().setType("VEC3").setArray(r.nor).setBuffer(buf));
    if (r.uv) prim.setAttribute("TEXCOORD_0", out.createAccessor().setType("VEC2").setArray(r.uv).setBuffer(buf));
    mesh.addPrimitive(prim);
    tris += r.idx.length / 3;
  }
  out.getRoot().setDefaultScene(scene);
  const file = `tree_${String(ti).padStart(2, "0")}_${kind.toLowerCase()}.glb`;
  await io.write(`${OUT}/${file}`, out);
  const half = Math.max(mx[0] - mn[0], mx[2] - mn[2]) * s / 2;
  manifest.push({ file, kind, height_m: HEIGHT[kind], crown_radius_m: +half.toFixed(2), triangles: tris, source: key });
  console.log(file, kind, "tris", tris, "crown r", half.toFixed(1), "bytes", fs.statSync(`${OUT}/${file}`).size);
  ti++;
}
fs.writeFileSync(`${OUT}/trees_manifest.json`, JSON.stringify(manifest, null, 1));

// ------------------------------------------------------------------------------------------------------ grass
const gdoc = await io.read(GRASS);
const gprims = collect(gdoc);
const mfG = [];
let gi = 0;
for (const g of gprims) {
  let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (let i = 0; i < g.pos.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], g.pos[i + k]); mx[k] = Math.max(mx[k], g.pos[i + k]); }
  const cx = (mn[0] + mx[0]) / 2, cz = (mn[2] + mx[2]) / 2, s = 1.0 / Math.max(mx[0] - mn[0], mx[2] - mn[2]);   // clump footprint = 1 m wide, scaled at placement
  for (let i = 0; i < g.pos.length; i += 3) { g.pos[i] = (g.pos[i] - cx) * s; g.pos[i + 1] = (g.pos[i + 1] - mn[1]) * s; g.pos[i + 2] = (g.pos[i + 2] - cz) * s; }
  const r = simplify(g, 260, 0.35);
  const out = new Document(); const buf = out.createBuffer();
  const scene = out.createScene("grass"); const node = out.createNode(`grass_${gi}`); scene.addChild(node);
  const col = g.mat.getBaseColorFactor();
  const mat = out.createMaterial("grass").setBaseColorFactor([0.30, 0.52, 0.2, 1]).setDoubleSided(true).setRoughnessFactor(0.95).setMetallicFactor(0);
  const prim = out.createPrimitive().setMaterial(mat)
    .setAttribute("POSITION", out.createAccessor().setType("VEC3").setArray(r.pos).setBuffer(buf))
    .setIndices(out.createAccessor().setType("SCALAR").setArray(new Uint16Array(r.idx)).setBuffer(buf));
  if (r.nor) prim.setAttribute("NORMAL", out.createAccessor().setType("VEC3").setArray(r.nor).setBuffer(buf));
  node.setMesh(out.createMesh("grass").addPrimitive(prim));
  out.getRoot().setDefaultScene(scene);
  await io.write(`${OUT}/grass_${gi}.glb`, out);
  mfG.push({ file: `grass_${gi}.glb`, triangles: r.idx.length / 3, height_over_width: +((mx[1] - mn[1]) * s).toFixed(3), source_color: col.map((v) => +v.toFixed(2)) });
  console.log(`grass_${gi}.glb tris`, r.idx.length / 3, "h/w", ((mx[1] - mn[1]) * s).toFixed(2));
  gi++;
}
fs.writeFileSync(`${OUT}/grass_manifest.json`, JSON.stringify(mfG, null, 1));
