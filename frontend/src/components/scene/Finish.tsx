import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { LiveData } from "./live";

/** Five-light start gantry: lights come on one by one, then all go out (driven by the race clock's start sequence). */
export function StartLights({ live, width }: { live: React.MutableRefObject<LiveData>; width: number }) {
  const mats = useMemo(() => Array.from({ length: 5 }, () => new THREE.MeshBasicMaterial({ color: "#2a0606" })), []);
  const last = useRef(-2);
  useFrame(() => {
    const n = live.current.startLights;
    if (n === last.current) return;
    last.current = n;
    mats.forEach((m, i) => m.color.set(n >= 1 && n <= 5 && i < n ? "#ff2a2a" : "#2a0606"));
  });
  const span = width + 4;
  return (
    <group position={[0, 9.5, 0]}>
      <mesh><boxGeometry args={[0.7, 1.7, span]} /><meshStandardMaterial color="#14161b" roughness={0.6} metalness={0.3} /></mesh>
      {mats.map((m, i) => {
        const z = (i - 2) * (span / 5.4);
        return [0.38, -0.38].map((y) => (
          <mesh key={`${i}${y}`} position={[-0.36, y, z]} rotation={[0, -Math.PI / 2, 0]}>
            <circleGeometry args={[0.3, 16]} />
            <primitive object={m} attach="material" />
          </mesh>
        ));
      })}
    </group>
  );
}

const chequerTex = (() => {
  let t: THREE.CanvasTexture | null = null;
  return () => {
    if (t) return t;
    const cv = document.createElement("canvas"); cv.width = 256; cv.height = 160;
    const g = cv.getContext("2d")!;
    for (let y = 0; y < 5; y++) for (let x = 0; x < 8; x++) { g.fillStyle = (x + y) % 2 ? "#f4f4f4" : "#101010"; g.fillRect(x * 32, y * 32, 32, 32); }
    t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
  };
})();

const hash = (n: number) => { const s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s); };
const CONFETTI = 220;
const COLORS = ["#ff2d3a", "#ffd23f", "#38d9f5", "#ffffff", "#7bd88f", "#c77dff"].map((c) => new THREE.Color(c));

/**
 * Chequered flag waved at the line once the leader has taken the flag (final lap complete), plus a confetti burst on
 * the rising edge. Both are triggered by the real race state (leader progress >= total laps), never by a timer alone.
 */
export function FinishFlag({ live, side, width }: { live: React.MutableRefObject<LiveData>; side: number; width: number }) {
  const pts = useRef<THREE.Points>(null);
  const group = useRef<THREE.Group>(null);
  const geo = useMemo(() => new THREE.PlaneGeometry(6, 3.6, 24, 12), []);
  const base = useMemo(() => Float32Array.from(geo.attributes.position.array as ArrayLike<number>), [geo]);
  const conf = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const col = new Float32Array(CONFETTI * 3);
    for (let i = 0; i < CONFETTI; i++) { const c = COLORS[i % COLORS.length]; col.set([c.r, c.g, c.b], i * 3); }
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(CONFETTI * 3), 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    return g;
  }, []);
  const st = useRef({ on: false, t0: 0 });

  useFrame(({ clock }) => {
    const L = live.current;
    const on = L.totalLaps > 0 && (L.finished || L.leaderTotal >= L.totalLaps);
    const S = st.current, t = clock.elapsedTime;
    if (on && !S.on) S.t0 = t;
    S.on = on;
    if (group.current) group.current.visible = on;
    if (!on) return;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = base[i * 3], y = base[i * 3 + 1];
      pos.setZ(i, Math.sin(x * 1.3 - t * 7 + y * 0.6) * 0.45 * ((x + 3) / 6));
    }
    pos.needsUpdate = true; geo.computeVertexNormals();
    const age = t - S.t0;
    if (pts.current) {
      pts.current.visible = age < 7;
      const p = conf.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < CONFETTI; i++) {
        const vx = (hash(i) - 0.5) * 14, vy = 9 + hash(i + 300) * 9, vz = (hash(i + 700) - 0.5) * width * 0.7;
        const a = Math.max(0, age - hash(i + 1000) * 0.6);
        p.setXYZ(i, vx * a * 0.5 + Math.sin(a * 3 + i) * 0.8, 6 + vy * a - 5.5 * a * a, vz * 0.35 * (1 - Math.exp(-a)) + Math.cos(a * 2 + i) * 0.6);
      }
      p.needsUpdate = true;
      (pts.current.material as THREE.PointsMaterial).opacity = Math.min(1, Math.max(0, 7 - age));
    }
  });

  return (
    <group ref={group} position={[0, 0, side]} visible={false}>
      <mesh position={[0, 5, 0]}><cylinderGeometry args={[0.1, 0.12, 10, 8]} /><meshStandardMaterial color="#d8dce2" metalness={0.6} roughness={0.4} /></mesh>
      <mesh geometry={geo} position={[3.1, 8.1, 0]}>
        <meshStandardMaterial map={chequerTex()} side={THREE.DoubleSide} roughness={0.8} />
      </mesh>
      <points ref={pts} geometry={conf} position={[0, 0, -side]} frustumCulled={false}>
        <pointsMaterial size={0.55} vertexColors transparent opacity={1} depthWrite={false} />
      </points>
    </group>
  );
}
