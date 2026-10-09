import { useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { KENNEY } from "../../lib/assets";
import { useGlbParts } from "./glb";
import type { LiveData } from "./live";

export interface Stand { m: THREE.Matrix4; model: string; size: number }

const PERSON = 1.75;                     // spectator height (m)
const PALETTE = ["#d9d9d6", "#c8312f", "#2b6cb0", "#e7b53a", "#3a3f4a", "#f2f2f0", "#2f8f5b", "#8a4fb3", "#e9742c"].map((c) => new THREE.Color(c));

let personGeo: THREE.BufferGeometry | null = null;
function person(): THREE.BufferGeometry {
  if (personGeo) return personGeo;
  const body = new THREE.BoxGeometry(0.5, 0.95, 0.3); body.translate(0, 0.62, 0);
  const head = new THREE.BoxGeometry(0.26, 0.28, 0.26); head.translate(0, 1.26, 0);
  const legs = new THREE.BoxGeometry(0.4, 0.2, 0.28); legs.translate(0, 0.1, 0);
  personGeo = mergeGeometries([body.toNonIndexed(), head.toNonIndexed(), legs.toNonIndexed()])!;
  personGeo.scale(PERSON / 1.4, PERSON / 1.4, PERSON / 1.4);
  return personGeo;
}

/** Horizontal (seat / step) surface points of a stand model, in the model's own units. */
function seatPoints(parts: { geometry: THREE.BufferGeometry; local: THREE.Matrix4 }[], bounds: THREE.Box3, step: number): THREE.Vector3[] {
  const tris: { a: THREE.Vector3; b: THREE.Vector3; c: THREE.Vector3 }[] = [];
  const n = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  for (const p of parts) {
    const pos = p.geometry.attributes.position as THREE.BufferAttribute;
    const idx = p.geometry.index;
    const count = idx ? idx.count : pos.count;
    const vert = (k: number) => new THREE.Vector3().fromBufferAttribute(pos, idx ? idx.getX(k) : k).applyMatrix4(p.local);
    for (let t = 0; t < count; t += 3) {
      const a = vert(t), b = vert(t + 1), c = vert(t + 2);
      n.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a)).normalize();
      if (Math.abs(n.y) > 0.95 && a.y > bounds.min.y + 0.03 * (bounds.max.y - bounds.min.y)) tris.push({ a, b, c });
    }
  }
  const out: THREE.Vector3[] = [];
  for (let x = bounds.min.x + step / 2; x < bounds.max.x; x += step) {
    for (let z = bounds.min.z + step / 2; z < bounds.max.z; z += step) {
      let best = -Infinity;
      for (const t of tris) {
        const d = (t.b.z - t.c.z) * (t.a.x - t.c.x) + (t.c.x - t.b.x) * (t.a.z - t.c.z);
        if (Math.abs(d) < 1e-9) continue;
        const l1 = ((t.b.z - t.c.z) * (x - t.c.x) + (t.c.x - t.b.x) * (z - t.c.z)) / d;
        const l2 = ((t.c.z - t.a.z) * (x - t.c.x) + (t.a.x - t.c.x) * (z - t.c.z)) / d;
        if (l1 >= 0 && l2 >= 0 && l1 + l2 <= 1) best = Math.max(best, t.a.y);
      }
      if (best > -Infinity) out.push(new THREE.Vector3(x, best, z));
    }
  }
  return out;
}

const hash = (n: number) => { const s = Math.sin(n * 91.7 + 13.1) * 43758.5453; return s - Math.floor(s); };

/**
 * Spectators on one grandstand, placed on the stand model's real seat surfaces (found from its geometry), drawn as one
 * instanced mesh. They sway gently and jump when the race state calls for it: lights out, the safety car appearing,
 * and the leader taking the chequered flag. Count follows the quality preset.
 */
export function StandCrowd({ stand, count, live }: { stand: Stand; count: number; live: React.MutableRefObject<LiveData> }) {
  const { parts, bounds } = useGlbParts(KENNEY(stand.model), false);
  const ref = useRef<THREE.InstancedMesh>(null);
  const cheer = useRef(0);
  const mats = useMemo(() => {
    const sz = bounds.getSize(new THREE.Vector3()), ctr = bounds.getCenter(new THREE.Vector3());
    const s = stand.size / Math.max(sz.x, sz.z, 1e-6);
    const seats = seatPoints(parts, bounds, 0.014);
    const take = Math.min(1, count / Math.max(1, seats.length));
    const world = new THREE.Matrix4().copy(stand.m)
      .multiply(new THREE.Matrix4().makeScale(s, s, s))
      .multiply(new THREE.Matrix4().makeTranslation(-ctr.x, -bounds.min.y, -ctr.z));
    const comp = new THREE.Matrix4().makeScale(1, 1 / 0.85, 1);        // undo the stand's vertical squash for people
    const out: THREE.Matrix4[] = [], cols: THREE.Color[] = [];
    seats.forEach((p, i) => {
      if (hash(i) > take) return;
      const m = new THREE.Matrix4().copy(world).multiply(new THREE.Matrix4().makeTranslation(p.x, p.y, p.z));
      const pos = new THREE.Vector3().setFromMatrixPosition(m);
      pos.y += 0.02;
      const q = new THREE.Quaternion().setFromRotationMatrix(stand.m);
      const jitter = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (hash(i + 5) - 0.5) * 0.5);
      out.push(new THREE.Matrix4().compose(pos, q.multiply(jitter), new THREE.Vector3(0.9 + hash(i + 9) * 0.25, 0.9 + hash(i + 11) * 0.2, 1)).multiply(comp));
      cols.push(PALETTE[Math.floor(hash(i + 3) * PALETTE.length)]);
    });
    return { out, cols };
  }, [parts, bounds, stand, count]);

  const uniforms = useMemo(() => ({ uTime: { value: 0 }, uCheer: { value: 0 } }), []);
  const material = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = uniforms.uTime; sh.uniforms.uCheer = uniforms.uCheer;
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nuniform float uTime; uniform float uCheer;")
        .replace("#include <begin_vertex>", `#include <begin_vertex>
          float ph = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.51;
          transformed.y += (0.5 + 0.5 * sin(uTime * 9.0 + ph * 7.0)) * uCheer * 0.28 * max(transformed.y, 0.0);
          transformed.x += sin(uTime * 1.3 + ph) * 0.02 * transformed.y;`);
    };
    m.customProgramCacheKey = () => "crowd";
    return m;
  }, [uniforms]);

  useLayoutEffect(() => {
    const im = ref.current; if (!im) return;
    mats.out.forEach((m, i) => { im.setMatrixAt(i, m); im.setColorAt(i, mats.cols[i]); });
    im.count = mats.out.length;
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
  }, [mats]);

  useFrame(({ clock }, dt) => {
    const L = live.current;
    const want = L.startLights === 6 || (L.totalLaps > 0 && (L.finished || L.leaderTotal >= L.totalLaps)) ? 1 : L.safetyCar ? 0.35 : 0;
    cheer.current += (want - cheer.current) * Math.min(1, dt * 3);
    uniforms.uCheer.value = cheer.current;
    uniforms.uTime.value = clock.elapsedTime;
  });

  if (!mats.out.length) return null;
  return <instancedMesh key={mats.out.length} ref={ref} args={[person(), material, mats.out.length]} castShadow={false} receiveShadow frustumCulled={false} />;
}
