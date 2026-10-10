import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { asset } from "../../lib/assets";
import type { Circuit } from "../../lib/circuit";
import type { QualitySettings } from "../../lib/quality";
import type { Terrain } from "../../lib/terrain";
import { BROADLEAF, CONIFER, planVegetation, type Exclusion, type VegInstance } from "../../lib/vegetation";
import type { LiveData } from "./live";

/**
 * Dense instanced vegetation (Kenney Nature Kit, CC0). One merged, vertex-coloured geometry per species, drawn as
 * InstancedMesh per spatial chunk:
 *   - near the camera: the detailed models (13 tree species + 5 bush/grass types),
 *   - beyond `veg.hiRadius`: a 20-60 triangle stand-in per chunk (one broadleaf, one conifer) so the whole venue stays
 *     populated from the overview camera,
 *   - chunks outside the view frustum are culled by three.js (each instanced mesh has its own bounding sphere).
 * The tree count is high (up to 34,000) but the draw-call count is bounded by the number of visible chunks.
 */
const T = (n: string) => asset(`environment/kenney-nature-kit/${n}.glb`);
const TREES = ["tree_default", "tree_default_dark", "tree_oak", "tree_oak_dark", "tree_detailed", "tree_fat", "tree_blocks",
  "tree_cone", "tree_cone_dark", "tree_pineDefaultA", "tree_pineDefaultB", "tree_pineRoundA", "tree_pineRoundC"];
const BUSHES = ["plant_bush", "plant_bushLarge", "plant_bushDetailed", "plant_bushTriangle", "grass_leafsLarge"];
const CHUNK = 450;

// the kit's own base colours are unusual; map material names onto a natural, slightly desaturated palette
const PALETTE: Record<string, string> = {
  leafsGreen: "#4e9a3a", leafsDark: "#2c6a35", woodBark: "#6d4a2e", woodBarkDark: "#4a3323", grass: "#5f9d45", _defaultMat: "#4e9a3a",
};

function bake(scene: THREE.Object3D): THREE.BufferGeometry {
  scene.updateMatrixWorld(true);
  const parts: THREE.BufferGeometry[] = [];
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const g = m.geometry.clone();
    g.applyMatrix4(m.matrixWorld);
    for (const k of Object.keys(g.attributes)) if (k !== "position" && k !== "normal") g.deleteAttribute(k);
    const name = (m.material as THREE.Material).name;
    const col = new THREE.Color(PALETTE[name] ?? "#4e9a3a");
    const n = g.attributes.position.count, arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) arr.set([col.r, col.g, col.b], i * 3);
    g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
    parts.push(g.index ? g : g);
  });
  const geo = (parts.length > 1 ? mergeGeometries(parts, false) : parts[0])!;
  geo.computeBoundingBox();
  const b = geo.boundingBox!, h = b.max.y - b.min.y || 1;
  geo.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
  geo.scale(1 / h, 1 / h, 1 / h);                        // unit height: an instance's scale is its height in metres
  geo.computeBoundingSphere();
  return geo;
}

function standIn(kind: "broad" | "conifer"): THREE.BufferGeometry {
  const trunk = new THREE.BoxGeometry(0.07, 0.4, 0.07); trunk.translate(0, 0.2, 0);
  const crown = kind === "broad" ? new THREE.IcosahedronGeometry(0.33, 0) : new THREE.ConeGeometry(0.27, 0.85, 6);
  if (kind === "broad") crown.scale(1, 0.95, 1);
  crown.translate(0, kind === "broad" ? 0.66 : 0.58, 0);
  const paint = (g: THREE.BufferGeometry, hex: string) => {
    const g2 = g.toNonIndexed(), c = new THREE.Color(hex), n = g2.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
    g2.setAttribute("color", new THREE.BufferAttribute(a, 3));
    for (const k of Object.keys(g2.attributes)) if (!["position", "normal", "color"].includes(k)) g2.deleteAttribute(k);
    return g2;
  };
  return mergeGeometries([paint(trunk, "#5a3d28"), paint(crown, kind === "broad" ? "#477f35" : "#2a6334")])!;
}

interface Chunk { cx: number; cz: number; hi: THREE.InstancedMesh[]; lo: THREE.InstancedMesh[]; bush: THREE.InstancedMesh[]; hiOn: boolean; loOn: boolean; bushOn: boolean }

export default function Vegetation({ circuit: c, terrain, q, exclusions }: {
  circuit: Circuit; terrain: Terrain; q: QualitySettings; live?: React.MutableRefObject<LiveData>; exclusions: Exclusion[];
}) {
  const treeGltf = TREES.map((n) => useGLTF(T(n)));      // eslint-disable-line react-hooks/rules-of-hooks
  const bushGltf = BUSHES.map((n) => useGLTF(T(n)));     // eslint-disable-line react-hooks/rules-of-hooks
  const uniforms = useMemo(() => ({ uTime: { value: 0 }, uWind: { value: 1 } }), []);

  const material = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = uniforms.uTime; sh.uniforms.uWind = uniforms.uWind;
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nuniform float uTime; uniform float uWind;")
        .replace("#include <begin_vertex>", `#include <begin_vertex>
          #ifdef USE_INSTANCING
            float ph = instanceMatrix[3].x * 0.045 + instanceMatrix[3].z * 0.037;
            float sw = uWind * position.y * position.y;
            transformed.x += sin(uTime * 1.7 + ph) * 0.04 * sw;
            transformed.z += cos(uTime * 1.3 + ph * 1.3) * 0.028 * sw;
          #endif`);
    };
    m.customProgramCacheKey = () => "vegetation";
    return m;
  }, [uniforms]);

  const geoms = useMemo(() => ({
    trees: treeGltf.map((g) => bake(g.scene)), bushes: bushGltf.map((g) => bake(g.scene)),
    loBroad: standIn("broad"), loCon: standIn("conifer"),
  }), [treeGltf, bushGltf]);

  const plan = useMemo(() => planVegetation(c, terrain.heightAt, { trees: q.veg.trees, bushes: q.veg.bushes, exclusions, half: terrain.size / 2 }),
    [c, terrain, q.veg.trees, q.veg.bushes, exclusions]);

  const root = useMemo(() => {
    const group = new THREE.Group();
    const chunks: Chunk[] = [];
    const byChunk = new Map<string, { t: VegInstance[]; b: VegInstance[]; cx: number; cz: number }>();
    const add = (i: VegInstance, tree: boolean) => {
      const gx = Math.floor(i.x / CHUNK), gz = Math.floor(i.z / CHUNK), key = `${gx},${gz}`;
      let e = byChunk.get(key);
      if (!e) { e = { t: [], b: [], cx: (gx + 0.5) * CHUNK, cz: (gz + 0.5) * CHUNK }; byChunk.set(key, e); }
      (tree ? e.t : e.b).push(i);
    };
    plan.trees.forEach((i) => add(i, true)); plan.bushes.forEach((i) => add(i, false));

    const m4 = new THREE.Matrix4(), qt = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
    const build = (list: VegInstance[], geo: THREE.BufferGeometry, scaleOf: (i: VegInstance) => THREE.Vector3): THREE.InstancedMesh => {
      const im = new THREE.InstancedMesh(geo, material, list.length);
      list.forEach((i, k) => {
        qt.setFromAxisAngle(up, i.rot);
        im.setMatrixAt(k, m4.compose(new THREE.Vector3(i.x, i.y, i.z), qt, scaleOf(i)));
        im.setColorAt(k, col.setScalar(i.tone));
      });
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.computeBoundingSphere(); im.computeBoundingBox();
      im.receiveShadow = true; im.castShadow = false;
      return im;
    };
    const treeScale = (i: VegInstance) => { const w = 0.9 + 0.25 * ((i.tone * 7.31) % 1); return new THREE.Vector3(i.h * w, i.h, i.h * w); };
    const bushScale = (i: VegInstance) => { const w = 0.9 + 0.3 * ((i.tone * 5.17) % 1); return new THREE.Vector3(i.h * w, i.h, i.h * w); };

    for (const e of byChunk.values()) {
      const ch: Chunk = { cx: e.cx, cz: e.cz, hi: [], lo: [], bush: [], hiOn: false, loOn: true, bushOn: false };
      const bySpecies: VegInstance[][] = Array.from({ length: TREES.length }, () => []);
      for (const i of e.t) bySpecies[i.species].push(i);
      bySpecies.forEach((l, s) => { if (l.length) { const im = build(l, geoms.trees[s], treeScale); im.visible = false; ch.hi.push(im); group.add(im); } });
      const broad = e.t.filter((i) => i.species < BROADLEAF), con = e.t.filter((i) => i.species >= BROADLEAF);
      if (broad.length) { const im = build(broad, geoms.loBroad, treeScale); ch.lo.push(im); group.add(im); }
      if (con.length) { const im = build(con, geoms.loCon, treeScale); ch.lo.push(im); group.add(im); }
      const bs: VegInstance[][] = Array.from({ length: BUSHES.length }, () => []);
      for (const i of e.b) bs[i.species].push(i);
      bs.forEach((l, s) => { if (l.length) { const im = build(l, geoms.bushes[s], bushScale); im.visible = false; ch.bush.push(im); group.add(im); } });
      chunks.push(ch);
    }
    (group.userData as { chunks: Chunk[] }).chunks = chunks;
    return group;
  }, [plan, geoms, material]);

  useEffect(() => () => {
    root.traverse((o) => { const im = o as THREE.InstancedMesh; if (im.isInstancedMesh) im.dispose(); });
  }, [root]);
  useEffect(() => () => material.dispose(), [material]);

  const frame = useRef(0);
  useFrame(({ camera, clock }) => {
    uniforms.uTime.value = clock.elapsedTime;
    uniforms.uWind.value = q.veg.wind ? 1 : 0;
    if (frame.current++ % 6 !== 0) return;
    const chunks = (root.userData as { chunks: Chunk[] }).chunks;
    const cp = camera.position, hiR = q.veg.hiRadius + CHUNK * 0.5, bR = q.veg.bushRadius + CHUNK * 0.5;
    for (const ch of chunks) {
      const d = Math.hypot(cp.x - ch.cx, cp.z - ch.cz) + Math.abs(cp.y) * 0.35;      // looking down from altitude counts as distance
      const hiOn = d < hiR, bushOn = d < bR;
      if (hiOn !== ch.hiOn) { ch.hiOn = hiOn; for (const m of ch.hi) { m.visible = hiOn; m.castShadow = hiOn && q.shadows; } for (const m of ch.lo) m.visible = !hiOn; }
      if (bushOn !== ch.bushOn) { ch.bushOn = bushOn; for (const m of ch.bush) m.visible = bushOn; }
    }
  });

  return <primitive object={root} />;
}
