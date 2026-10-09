import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Circuit } from "../../lib/circuit";
import { speedProfileFor } from "../../lib/speedProfile";
import type { QualitySettings } from "../../lib/quality";
import type { LiveData } from "./live";
import { strip } from "./trackGeometry";

/**
 * Tyre rubber laid down in the braking zones of the speed profile (where cars actually decelerate hard), two thin
 * tracks per zone, strongest where deceleration peaks. It builds up with laps completed by the leader and is washed
 * away as the track gets wet. No marks exist anywhere a car does not brake.
 */
const THRESH = 16;      // m/s^2 of deceleration that counts as a braking zone

export default function Skids({ circuit: c, live, q }: { circuit: Circuit; live: React.MutableRefObject<LiveData>; q: QualitySettings }) {
  const uOpacity = useRef({ value: 0 });
  const geo = useMemo(() => {
    const prof = speedProfileFor(c);
    const n = c.n;
    let peak = 1;
    for (let i = 0; i < n; i++) peak = Math.max(peak, prof.brake[i]);
    const parts: THREE.BufferGeometry[] = [];
    const tracks: [number, number][] = q.skidDetail ? [[-1.0, -0.78], [-0.42, -0.2], [0.2, 0.42], [0.78, 1.0]] : [[-0.95, -0.7], [0.7, 0.95]];
    // contiguous runs of braking samples (wrapping around the lap), at least ~40 m long
    let start = -1;
    const runs: [number, number][] = [];
    const first = prof.brake.findIndex((b) => b < THRESH);
    for (let k = 0; k < n; k++) {
      const i = (first + k) % n, on = prof.brake[i] >= THRESH;
      if (on && start < 0) start = k;
      if ((!on || k === n - 1) && start >= 0) { runs.push([(first + start) % n, k - start + (on ? 1 : 0)]); start = -1; }
    }
    for (const [s0, len] of runs) {
      if (len < 5) continue;
      const samples = Array.from({ length: len }, (_, j) => { const i = (s0 + j) % n; return { x: c.x[i], y: c.y[i], tx: c.tx[i], ty: c.ty[i], b: prof.brake[i] / peak }; });
      for (const [a, b] of tracks) {
        // vertex "colour" carries the mark strength (0 at the ends of the zone, 1 at peak braking)
        parts.push(strip(samples, () => a, () => b, 0.075, false,
          (j) => { const e = Math.min(j, len - 1 - j) / Math.max(2, len * 0.3); const s = Math.min(1, e) * (0.35 + 0.65 * samples[j].b); return new THREE.Color(s, s, s); }));
      }
    }
    if (!parts.length) return null;
    // merge
    let total = 0, ti = 0;
    for (const g of parts) { total += g.attributes.position.count; ti += g.index!.count; }
    const pos = new Float32Array(total * 3), col = new Float32Array(total * 3), uv = new Float32Array(total * 2), idx = new Uint32Array(ti);
    let vo = 0, io = 0;
    for (const g of parts) {
      pos.set(g.attributes.position.array as Float32Array, vo * 3);
      col.set(g.attributes.color.array as Float32Array, vo * 3);
      const ix = g.index!.array;
      for (let i = 0; i < ix.length; i++) idx[io + i] = ix[i] + vo;
      vo += g.attributes.position.count; io += ix.length;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    out.setAttribute("color", new THREE.BufferAttribute(col, 3));
    out.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    out.setIndex(new THREE.BufferAttribute(idx, 1));
    return out;
  }, [c, q.skidDetail]);

  const mat = useMemo(() => {
    const m = new THREE.MeshBasicMaterial({ color: "#050505", vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uOpacity = uOpacity.current;
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform float uOpacity;")
        .replace("#include <color_fragment>", "diffuseColor.a *= vColor.r * uOpacity;");
    };
    m.customProgramCacheKey = () => "skids";
    return m;
  }, []);
  const mesh = useRef<THREE.Mesh>(null);

  useFrame(() => {
    const L = live.current;
    // rubber builds with laps run (to ~0.6 after 12 laps) and disappears as the surface gets wet
    const rubber = Math.min(1, Math.max(0, L.leaderTotal) / 12) * 0.34;
    const dry = 1 - Math.min(1, Math.max(0, (L.wet - 0.08) / 0.4));
    uOpacity.current.value = rubber * dry;
    if (mesh.current) mesh.current.visible = uOpacity.current.value > 0.01;
  });

  if (!geo) return null;
  return <mesh ref={mesh} geometry={geo} material={mat} renderOrder={2} frustumCulled={false} />;
}
