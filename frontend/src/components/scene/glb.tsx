import { useLayoutEffect, useMemo, useRef } from "react";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";

/** The Kenney palette is pastel; remap named materials to richer values that sit well in a PBR scene. */
const KENNEY_PALETTE: Record<string, { color: string; roughness: number; metalness?: number }> = {
  carTire: { color: "#1b1b1f", roughness: 0.9 },
  glass: { color: "#1c2535", roughness: 0.12, metalness: 0.3 },
  grey: { color: "#d4cfd0", roughness: 0.75 },
  red: { color: "#b3202c", roughness: 0.55 },
  grass: { color: "#2f6b34", roughness: 0.95 },
  bark: { color: "#5a3f2c", roughness: 0.95 },
  road: { color: "#3a3a40", roughness: 0.9 },
  pylon: { color: "#e8821a", roughness: 0.6 },
};

const restyled = new WeakMap<THREE.Material, THREE.Material>();
export function restyleKenney(src: THREE.Material | THREE.Material[]): THREE.Material | THREE.Material[] {
  if (Array.isArray(src)) return src.map((m) => restyleKenney(m) as THREE.Material);
  const cached = restyled.get(src);
  if (cached) return cached;
  const m = (src as THREE.MeshStandardMaterial).clone();
  const p = KENNEY_PALETTE[src.name];
  if (p && m.color) {
    m.color.set(p.color);
    m.roughness = p.roughness;
    m.metalness = p.metalness ?? 0;
  } else if (m.color) {
    m.color.multiplyScalar(0.85);
    m.roughness = 0.85;
    m.metalness = 0;
  }
  restyled.set(src, m);
  return m;
}

interface Part { geometry: THREE.BufferGeometry; material: THREE.Material | THREE.Material[]; local: THREE.Matrix4 }

/** Meshes of a loaded GLB with their transforms relative to the model root. */
export function useGlbParts(url: string, restyle = true): { parts: Part[]; bounds: THREE.Box3 } {
  const gltf = useGLTF(url);
  return useMemo(() => {
    const parts: Part[] = [];
    gltf.scene.updateWorldMatrix(true, true);
    const bounds = new THREE.Box3();
    gltf.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      parts.push({ geometry: m.geometry, material: restyle ? restyleKenney(m.material) : m.material, local: m.matrixWorld.clone() });
      const b = new THREE.Box3().setFromObject(m);
      bounds.union(b);
    });
    return { parts, bounds };
  }, [gltf, restyle]);
}

/**
 * Many copies of one GLB as instanced meshes (one draw call per mesh part).
 * `xf` are world transforms; each model is re-centred on its footprint and rests on y = 0, then scaled by `scale`.
 */
export function GlbInstances({ url, xf, scale = [1, 1, 1], shadow = true, receive = true, restyle = true, recentre = true }: {
  url: string; xf: THREE.Matrix4[]; scale?: [number, number, number]; shadow?: boolean; receive?: boolean; restyle?: boolean; recentre?: boolean;
}) {
  const { parts, bounds } = useGlbParts(url, restyle);
  const refs = useRef<(THREE.InstancedMesh | null)[]>([]);
  const base = useMemo(() => {
    const c = bounds.getCenter(new THREE.Vector3());
    const sc = new THREE.Matrix4().makeScale(scale[0], scale[1], scale[2]);
    return recentre ? sc.multiply(new THREE.Matrix4().makeTranslation(-c.x, -bounds.min.y, -c.z)) : sc;
  }, [bounds, scale, recentre]);
  useLayoutEffect(() => {
    const tmp = new THREE.Matrix4();
    parts.forEach((p, k) => {
      const im = refs.current[k];
      if (!im) return;
      xf.forEach((m, i) => {
        tmp.copy(m).multiply(base).multiply(p.local);
        im.setMatrixAt(i, tmp);
      });
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
    });
  }, [parts, xf, base]);
  if (!xf.length) return null;
  return (
    <>
      {parts.map((p, k) => (
        <instancedMesh key={`${url}-${k}-${xf.length}`} ref={(r) => { refs.current[k] = r; }}
          args={[p.geometry, p.material as THREE.Material, xf.length]} castShadow={shadow} receiveShadow={receive} frustumCulled={false} />
      ))}
    </>
  );
}

/** A single GLB placed once, uniformly scaled to `size` metres along its longest horizontal axis. */
export function GlbObject({ url, size, restyle = true, ...rest }: { url: string; size: number; restyle?: boolean } & JSX.IntrinsicElements["group"]) {
  const { parts, bounds } = useGlbParts(url, restyle);
  const { s, off } = useMemo(() => {
    const sz = bounds.getSize(new THREE.Vector3());
    const c = bounds.getCenter(new THREE.Vector3());
    return { s: size / Math.max(sz.x, sz.z, 1e-6), off: new THREE.Vector3(-c.x, -bounds.min.y, -c.z) };
  }, [bounds, size]);
  return (
    <group {...rest}>
      <group scale={s}>
        <group position={off}>
          {parts.map((p, k) => (
            <mesh key={k} geometry={p.geometry} material={p.material} matrixAutoUpdate={false}
              matrix={p.local} castShadow receiveShadow />
          ))}
        </group>
      </group>
    </group>
  );
}
