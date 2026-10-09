import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Circuit } from "../../lib/circuit";
import type { QualitySettings } from "../../lib/quality";
import type { Terrain } from "../../lib/terrain";
import { KENNEY, OLD_TYRE } from "../../lib/assets";
import { GlbInstances, GlbObject } from "./glb";
import { makePbrMaterial, patchWet, usePbr, type WetUniform } from "./materials";
import { poseMatrix } from "./trackGeometry";
import { Safe } from "./Safe";
import { StandCrowd } from "./Crowd";
import type { LiveData } from "./live";

/** Level of detail for small props: hidden when the camera is high above the circuit (they are sub-pixel from there). */
function HideWhenHigh({ y, children }: { y: number; children: React.ReactNode }) {
  const g = useRef<THREE.Group>(null);
  useFrame(({ camera }) => { if (g.current) g.current.visible = camera.position.y < y; });
  return <group ref={g}>{children}</group>;
}
/** Crowd LOD: a stand's spectators are only drawn when the camera is within `dist` metres of the stand. */
function Near({ at, dist, children }: { at: THREE.Matrix4; dist: number; children: React.ReactNode }) {
  const g = useRef<THREE.Group>(null);
  const p = useMemo(() => new THREE.Vector3().setFromMatrixPosition(at), [at]);
  useFrame(({ camera }) => { if (g.current) g.current.visible = camera.position.distanceTo(p) < dist; });
  return <group ref={g}>{children}</group>;
}

function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Matrix placing an object so its local +Z faces the scene direction (vx, vz). */
function facing(x: number, y: number, z: number, vx: number, vz: number): THREE.Matrix4 {
  const m = new THREE.Matrix4().makeRotationY(Math.atan2(vx, vz));
  m.setPosition(x, y, z);
  return m;
}

export function Ground({ terrain, q, wet }: { terrain: Terrain; q: QualitySettings; wet: WetUniform }) {
  const t = usePbr("grass_ground", q.anisotropy);
  const mat = useMemo(() => {
    const m = makePbrMaterial(t, { color: "#b4cf8e", normalScale: 0.9 });
    patchWet(m, wet, { puddles: 0.15, darken: 0.72, key: "grass" });
    return m;
  }, [t, wet]);
  useEffect(() => () => mat.dispose(), [mat]);
  return <mesh geometry={terrain.geometry} material={mat} receiveShadow />;
}

/** Pit garages along the lane, fresh-tyre stacks at every box, offices at the ends and a paddock behind. */
export function PitComplex({ circuit: c }: { circuit: Circuit }) {
  const { garages, offices, tyres, tents } = useMemo(() => {
    const garages: THREE.Matrix4[] = [], offices: THREE.Matrix4[] = [], tyres: THREE.Matrix4[] = [], tents: THREE.Matrix4[] = [];
    const m = c.pit.x.length;
    for (let i = 4; i < m - 4; i++) {
      const p = { x: c.pit.x[i], y: c.pit.y[i], tx: c.pit.tx[i], ty: c.pit.ty[i] };
      const nx = -p.ty, nz = -p.tx;                               // lane's left normal in scene coordinates
      const gx = p.x - nx * 19, gz = -p.y - nz * 19;
      const mat = facing(gx, 0, gz, nx, nz);
      (i === 4 || i === m - 5 ? offices : garages).push(mat);
      if (i % 2 === 0 && i !== 4 && i !== m - 5) {
        // two stacks of four fresh tyres in front of the garage
        for (const side of [-2.2, 2.2]) {
          const bx = p.x - nx * 11.2 + p.tx * side, bz = -p.y - nz * 11.2 - p.ty * side;
          for (let h = 0; h < 4; h++) {
            const t = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
            t.setPosition(bx, 0.08 + h * 0.17, bz);
            tyres.push(t);
          }
        }
      }
      if (i % 4 === 0) tents.push(facing(p.x - nx * 52, 0, -p.y - nz * 52, nx, nz));
    }
    return { garages, offices, tyres, tents };
  }, [c]);
  return (
    <>
      <Safe name="pit garages"><GlbInstances url={KENNEY("pitsGarage")} xf={garages} scale={[8.6, 9, 10]} /></Safe>
      <Safe name="pit offices"><GlbInstances url={KENNEY("pitsOffice")} xf={offices} scale={[10, 9, 10]} /></Safe>
      <Safe name="paddock tents"><GlbInstances url={KENNEY("tentLong")} xf={tents} scale={[9, 9, 9]} /></Safe>
      <Safe name="pit tyre stacks"><GlbInstances url={OLD_TYRE} xf={tyres} restyle={false} recentre={false} /></Safe>
    </>
  );
}

const AD_BRANDS = [
  ["AXIOM", "#38d9f5", "#06222b"], ["BRAVURA", "#22d37a", "#04210f"], ["CRESTLINE", "#b28cff", "#190b33"],
  ["DELTAWING", "#ffb020", "#2b1c02"], ["EMBER OIL", "#ff7a3d", "#2a0e03"], ["FORGE TYRES", "#e86cff", "#2a0a2e"],
];

function adTexture(name: string, fg: string, bg: string): THREE.CanvasTexture {
  const cv = document.createElement("canvas"); cv.width = 1024; cv.height = 128;
  const g = cv.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 1024, 0); grad.addColorStop(0, bg); grad.addColorStop(1, "#0b0b0e");
  g.fillStyle = grad; g.fillRect(0, 0, 1024, 128);
  g.fillStyle = fg; g.font = "italic 700 76px 'Barlow Condensed', Impact, sans-serif"; g.textBaseline = "middle";
  g.fillText(name, 40, 66);
  g.fillRect(0, 118, 1024, 10);
  g.fillStyle = "rgba(255,255,255,.65)"; g.font = "600 22px monospace"; g.textAlign = "right"; g.fillText("fictional brand", 1000, 100);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

function AdBoards({ circuit: c, q }: { circuit: Circuit; q: QualitySettings }) {
  const groups = useMemo(() => {
    const per: THREE.Matrix4[][] = AD_BRANDS.map(() => []);
    let k = 0;
    // along the outside of the start/finish straight and the long straights, behind the barrier line
    const step = Math.max(4, Math.round(5 / q.props));
    for (let i = 8; i < c.n; i += step) {
      const left = c.data.corners.every((z) => Math.abs(i - z.index) > 9);
      if (!left) continue;
      const p = { x: c.x[i], y: c.y[i], tx: c.tx[i], ty: c.ty[i] };
      const nx = -p.ty, nz = -p.tx;
      const lat = c.hl[i] + 13;
      const m = new THREE.Matrix4().makeRotationY(Math.atan2(-nx, -nz));   // face the track
      m.setPosition(p.x + (-p.ty) * lat, 1.4, -(p.y + p.tx * lat));
      per[k++ % per.length].push(m);
    }
    return per;
  }, [c, q.props]);
  const textures = useMemo(() => AD_BRANDS.map(([n, fg, bg]) => adTexture(n, fg, bg)), []);
  return (
    <>
      {groups.map((xf, i) => <AdBatch key={i} xf={xf} tex={textures[i]} />)}
    </>
  );
}

function AdBatch({ xf, tex }: { xf: THREE.Matrix4[]; tex: THREE.Texture }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const im = ref.current; if (!im) return;
    xf.forEach((m, i) => im.setMatrixAt(i, m));
    im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere();
  }, [xf]);
  if (!xf.length) return null;
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, xf.length]} castShadow frustumCulled={false}>
      <boxGeometry args={[7.5, 1.1, 0.12]} />
      <meshStandardMaterial map={tex} roughness={0.45} emissive="#ffffff" emissiveMap={tex} emissiveIntensity={0.35} />
    </instancedMesh>
  );
}

export function Scenery({ circuit: c, terrain, q, live }: { circuit: Circuit; terrain: Terrain; q: QualitySettings; live: React.MutableRefObject<LiveData> }) {
  const { trees, small, stands, posts, fences, marshals } = useMemo(() => {
    const r = rng(1234);
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (let i = 0; i < c.n; i++) { minX = Math.min(minX, c.x[i]); maxX = Math.max(maxX, c.x[i]); minZ = Math.min(minZ, -c.y[i]); maxZ = Math.max(maxZ, -c.y[i]); }
    const trees: THREE.Matrix4[] = [], small: THREE.Matrix4[] = [];
    let tries = 0;
    while (trees.length + small.length < q.trees && tries++ < q.trees * 25) {
      const x = minX - 500 + r() * (maxX - minX + 1000), z = minZ - 500 + r() * (maxZ - minZ + 1000);
      if (c.distanceToTrack(x, -z) < 80) continue;
      const s = 5 + r() * 4.5, y = terrain.heightAt(x, z) - 0.1;
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6.28),
        r() < 0.65 ? new THREE.Vector3(s, s * (0.9 + r() * 0.5), s) : new THREE.Vector3(s * 1.2, s * 1.2, s * 1.2));
      (r() < 0.65 ? trees : small).push(m);
    }
    // grandstands: along the start straight and on the outside of the landmark corners
    const stands: { m: THREE.Matrix4; model: string; size: number }[] = [];
    const addStand = (idx: number, left: boolean, model: string, off: number, size: number) => {
      const i = ((idx % c.n) + c.n) % c.n;
      const w = left ? c.hl[i] : c.hr[i];
      const lat = (w + off) * (left ? 1 : -1);
      const nx = -c.ty[i], ny = c.tx[i];
      const pos = new THREE.Vector3(c.x[i] + nx * lat, 0, -(c.y[i] + ny * lat));
      const dir = left ? -1 : 1;
      stands.push({ m: facing(pos.x, terrain.heightAt(pos.x, pos.z), pos.z, -c.ty[i] * dir, -c.tx[i] * dir).multiply(new THREE.Matrix4().makeScale(1, 0.85, 1)), model, size });
    };
    addStand(c.n - 16, true, "grandStandCovered", 28, 34);
    addStand(c.n - 6, true, "grandStandCovered", 28, 34);
    addStand(10, true, "grandStandAwning", 28, 34);
    addStand(21, true, "grandStand", 28, 34);
    for (const l of c.data.landmarks) {
      if (l.kind !== "corner") continue;
      const corner = c.data.corners.find((k) => k.index === l.index);
      addStand(l.index, corner?.turn === "left" ? false : true, "grandStandRound", 40, 46);
    }
    // lamp posts and fences
    const posts: THREE.Matrix4[] = [], fences: THREE.Matrix4[] = [], marshals: THREE.Matrix4[] = [];
    const lampStep = Math.round(26 / Math.max(0.3, q.props));
    for (let i = 6; i < c.n; i += lampStep) {
      const p = { x: c.x[i], y: c.y[i], tx: c.tx[i], ty: c.ty[i] };
      posts.push(poseMatrix(p, c.hl[i] + 11, 0, Math.PI / 2));
    }
    for (let i = 0; i < c.n; i += Math.max(2, Math.round(3 / q.props))) {
      // spectator fence along the outside of straights (not on corners)
      if (!c.data.corners.every((z) => Math.abs(i - z.index) > 10)) continue;
      const p = { x: c.x[i], y: c.y[i], tx: c.tx[i], ty: c.ty[i] };
      fences.push(poseMatrix(p, c.hl[i] + 16, 0));
    }
    for (const k of c.data.corners) {
      if (k.n % 2) continue;
      const i = k.index;
      const p = { x: c.x[i], y: c.y[i], tx: c.tx[i], ty: c.ty[i] };
      const outsideLeft = k.turn === "right";
      marshals.push(poseMatrix(p, outsideLeft ? c.hl[i] + 29 : -(c.hr[i] + 29), 0, 0));
    }
    return { trees, small, stands, posts, fences, marshals };
  }, [c, terrain, q.trees, q.props]);

  return (
    <>
      <Safe name="trees"><GlbInstances url={KENNEY("treeLarge")} xf={trees} /></Safe>
      <Safe name="trees (small)"><GlbInstances url={KENNEY("treeSmall")} xf={small} /></Safe>
      {stands.map((s, i) => (
        <group key={i}>
        <Safe name="grandstand">
          <GlbObject url={KENNEY(s.model)} size={s.size} matrixAutoUpdate={false} matrix={s.m} />
        </Safe>
        {q.crowd > 0 && <Near at={s.m} dist={q.lod * 4.5}><Safe name="crowd"><StandCrowd stand={s} count={Math.round(q.crowd / stands.length)} live={live} /></Safe></Near>}
        </group>
      ))}
      <HideWhenHigh y={q.lod * 5}><Safe name="lamp posts"><GlbInstances url={KENNEY("lightPostLarge")} xf={posts} scale={[15, 15, 15]} /></Safe></HideWhenHigh>
      <HideWhenHigh y={q.lod * 5}><Safe name="fences"><GlbInstances url={KENNEY("fenceStraight")} xf={fences} scale={[6, 4, 6]} shadow={false} /></Safe></HideWhenHigh>
      <HideWhenHigh y={q.lod * 5}><Safe name="ad boards"><AdBoards circuit={c} q={q} /></Safe></HideWhenHigh>
      <HideWhenHigh y={q.lod * 5}><Safe name="marshal posts"><GlbInstances url={KENNEY("tentClosed")} xf={marshals} scale={[4, 4, 4]} /></Safe></HideWhenHigh>
    </>
  );
}
