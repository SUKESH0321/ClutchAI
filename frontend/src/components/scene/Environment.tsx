import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import type { Circuit } from "../../lib/circuit";
import { buildTrackGeometries } from "./trackGeometry";
import type { LiveData } from "./live";
import type { Recommendation } from "../../types/race";

function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function noiseTexture(base: string, spots: string[], size = 256): THREE.CanvasTexture {
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const g = cv.getContext("2d")!;
  g.fillStyle = base; g.fillRect(0, 0, size, size);
  const rnd = mulberry32(7);
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = spots[Math.floor(rnd() * spots.length)];
    const s = 1 + rnd() * 3;
    g.fillRect(rnd() * size, rnd() * size, s, s);
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function chequerTexture(): THREE.CanvasTexture {
  const cv = document.createElement("canvas");
  cv.width = 64; cv.height = 8;
  const g = cv.getContext("2d")!;
  for (let x = 0; x < 16; x++) for (let y = 0; y < 2; y++) {
    g.fillStyle = (x + y) % 2 ? "#0b0b0b" : "#f4f4f4";
    g.fillRect(x * 4, y * 4, 4, 4);
  }
  const t = new THREE.CanvasTexture(cv);
  t.magFilter = THREE.NearestFilter;
  return t;
}

interface Props {
  circuit: Circuit;
  live: React.MutableRefObject<LiveData>;
  reco: Recommendation | null;
  boxLabel: string;
}

export default function Environment({ circuit: c, live, reco, boxLabel }: Props) {
  const geo = useMemo(() => buildTrackGeometries(c), [c]);
  const grassTex = useMemo(() => {
    const t = noiseTexture("#3a4a30", ["#425535", "#31402a", "#4b6139", "#2d3a26"]);
    t.repeat.set(900, 900);
    return t;
  }, []);
  const fieldTex = useMemo(() => {
    const t = noiseTexture("#4e6a3c", ["#587644","#42592f","#5e7d49"]);
    t.repeat.set(1.5, 400);
    return t;
  }, []);
  const chk = useMemo(() => chequerTexture(), []);
  const roadMat = useRef<THREE.MeshPhysicalMaterial>(null);
  const pitGlow = useRef<THREE.MeshBasicMaterial>(null);
  const scGlow = useRef<THREE.MeshBasicMaterial>(null);
  const wetColor = useMemo(() => new THREE.Color("#1d1f24"), []);
  const dryColor = useMemo(() => new THREE.Color("#4a4e58"), []);

  // trees: seeded, kept clear of the circuit
  const trees = useMemo(() => {
    const rnd = mulberry32(1234);
    const { minX, maxX, minZ, maxZ } = geo.bounds;
    const out: { x: number; z: number; s: number }[] = [];
    let guard = 0;
    while (out.length < 900 && guard++ < 20000) {
      const x = minX - 500 + rnd() * (maxX - minX + 1000);
      const z = minZ - 500 + rnd() * (maxZ - minZ + 1000);
      if (c.distanceToTrack(x, -z) < 75) continue;
      out.push({ x, z, s: 0.8 + rnd() * 1.5 });
    }
    return out;
  }, [c, geo]);
  const foliage = useRef<THREE.InstancedMesh>(null);
  const trunks = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const o = new THREE.Object3D();
    trees.forEach((t, i) => {
      o.position.set(t.x, 5 * t.s, t.z); o.scale.set(t.s * 3.2, t.s * 8, t.s * 3.2); o.rotation.y = i; o.updateMatrix();
      foliage.current?.setMatrixAt(i, o.matrix);
      o.position.set(t.x, 1.5 * t.s, t.z); o.scale.set(t.s * 0.6, t.s * 3, t.s * 0.6); o.updateMatrix();
      trunks.current?.setMatrixAt(i, o.matrix);
    });
    if (foliage.current) foliage.current.instanceMatrix.needsUpdate = true;
    if (trunks.current) trunks.current.instanceMatrix.needsUpdate = true;
  }, [trees]);

  // grandstands: stepped boxes along the track at landmark positions
  const stands = useMemo(() => {
    const list: { x: number; z: number; yaw: number; len: number; color: string }[] = [];
    const add = (idx: number, side: "left" | "right", len: number, off: number, color: string) => {
      const i = ((idx % c.n) + c.n) % c.n;
      const nx = -c.ty[i], ny = c.tx[i];
      const s = side === "left" ? 1 : -1;
      const w = side === "left" ? c.hl[i] : c.hr[i];
      list.push({ x: c.x[i] + nx * s * (w + off), z: -(c.y[i] + ny * s * (w + off)), yaw: Math.atan2(c.ty[i], c.tx[i]) + (side === "left" ? 0 : Math.PI), len, color });
    };
    add(c.n - 16, "left", 130, 30, "#3d4a63");
    add(10, "left", 120, 30, "#4a3d63");
    c.data.landmarks.filter((l) => l.kind === "corner").forEach((l, k) => {
      const corner = c.data.corners.find((q) => q.index === l.index);
      add(l.index, corner?.turn === "left" ? "right" : "left", 80, 44, k % 2 ? "#5b4040" : "#3f5a4b");
    });
    return list;
  }, [c]);

  const start = useMemo(() => c.pointAt(0), [c]);
  const sectorPoses = useMemo(() => c.data.sectors.fractions.slice(1).map((f) => c.pointAt(f)), [c]);
  const pitIn = useMemo(() => c.pitAt(0), [c]);
  const pitOut = useMemo(() => c.pitAt(c.pit.length), [c]);
  const lm = useMemo(() => c.data.landmarks.map((l) => {
    const i = ((l.index % c.n) + c.n) % c.n;
    return { name: l.name, x: c.x[i], z: -c.y[i], kind: l.kind };
  }), [c]);
  const cornerLabels = useMemo(() => c.data.corners.map((k) => {
    const i = k.index, nx = -c.ty[i], ny = c.tx[i], s = k.turn === "left" ? -1 : 1;
    const off = (s > 0 ? c.hl[i] : c.hr[i]) + 38;
    return { n: k.n, x: c.x[i] + nx * s * off, z: -(c.y[i] + ny * s * off) };
  }), [c]);

  useFrame(({ clock }) => {
    const w = live.current.wetness;
    const r = roadMat.current;
    if (r) {
      r.color.copy(dryColor).lerp(wetColor, Math.min(1, w * 1.4));
      r.roughness = 0.92 - 0.7 * Math.min(1, w * 1.3);
      r.clearcoat = Math.min(1, w * 1.2);
    }
    const t = clock.elapsedTime;
    if (scGlow.current) scGlow.current.opacity = live.current.safetyCar ? 0.45 + 0.4 * Math.sin(t * 6) : 0;
    const g = pitGlow.current;
    if (g) {
      const proposing = reco?.action === "BOX_THIS_LAP";
      const ph = live.current.primaryPit;
      if (ph === "stopped") { g.color.set("#22d37a"); g.opacity = 0.55; }
      else if (ph === "in" || ph === "out") { g.color.set("#22d37a"); g.opacity = 0.35; }
      else if (proposing) { g.color.set("#ff2d3a"); g.opacity = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(t * 7)); }
      else g.opacity = 0;
    }
  });

  const proposing = reco?.action === "BOX_THIS_LAP";
  return (
    <group>
      {/* ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.3, 0]} receiveShadow>
        <planeGeometry args={[9000, 9000]} />
        <meshStandardMaterial map={grassTex} roughness={1} />
      </mesh>
      <mesh geometry={geo.grass} position={[0, -0.1, 0]} receiveShadow>
        <meshStandardMaterial map={fieldTex} color="#ffffff" roughness={1} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={geo.gravel} receiveShadow>
        <meshStandardMaterial color="#8c8466" roughness={1} side={THREE.DoubleSide} />
      </mesh>

      {/* road */}
      <mesh geometry={geo.road} receiveShadow>
        <meshPhysicalMaterial ref={roadMat} color="#4a4e58" roughness={0.92} clearcoatRoughness={0.25} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={geo.edgeL}><meshBasicMaterial color="#e8e8e8" side={THREE.DoubleSide} /></mesh>
      <mesh geometry={geo.edgeR}><meshBasicMaterial color="#e8e8e8" side={THREE.DoubleSide} /></mesh>
      <mesh geometry={geo.kerbs} receiveShadow><meshStandardMaterial vertexColors roughness={0.7} side={THREE.DoubleSide} /></mesh>
      <mesh geometry={geo.arrows}><meshBasicMaterial color="#ffffff" transparent opacity={0.28} side={THREE.DoubleSide} /></mesh>
      <mesh geometry={geo.walls} castShadow><meshStandardMaterial vertexColors roughness={0.6} side={THREE.DoubleSide} /></mesh>
      <mesh geometry={geo.scGlow}><meshBasicMaterial ref={scGlow} color="#ffb020" transparent opacity={0} side={THREE.DoubleSide} /></mesh>

      {/* pit lane + garages */}
      <mesh geometry={geo.pitLane} receiveShadow><meshStandardMaterial color="#454a54" roughness={0.9} side={THREE.DoubleSide} /></mesh>
      <mesh geometry={geo.pitGlow}><meshBasicMaterial ref={pitGlow} color="#ff2d3a" transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} /></mesh>
      <mesh geometry={geo.pitWall} castShadow><meshStandardMaterial vertexColors side={THREE.DoubleSide} /></mesh>
      <mesh geometry={geo.garageWall} castShadow receiveShadow><meshStandardMaterial color="#20252e" roughness={0.6} side={THREE.DoubleSide} /></mesh>
      <mesh geometry={geo.garageRoof} castShadow><meshStandardMaterial color="#14171d" roughness={0.5} side={THREE.DoubleSide} /></mesh>

      {/* start / finish line + gantry */}
      <group position={[start.x, 0.12, -start.y]} rotation={[0, Math.atan2(start.ty, start.tx), 0]}>
        <mesh rotation={[-Math.PI / 2, 0, Math.PI / 2]}>
          <planeGeometry args={[c.hl[0] + c.hr[0], 4]} />
          <meshBasicMaterial map={chk} />
        </mesh>
        <mesh position={[0, 8, 0]} castShadow><boxGeometry args={[2, 1.6, c.hl[0] + c.hr[0] + 12]} /><meshStandardMaterial color="#3a141c" /></mesh>
        <mesh position={[0, 4, c.hl[0] + 5]} castShadow><boxGeometry args={[1.2, 8, 1.2]} /><meshStandardMaterial color="#1c2028" /></mesh>
        <mesh position={[0, 4, -(c.hr[0] + 5)]} castShadow><boxGeometry args={[1.2, 8, 1.2]} /><meshStandardMaterial color="#1c2028" /></mesh>
        <mesh position={[-1.1, 8, 0]}><boxGeometry args={[0.2, 0.7, c.hl[0] + c.hr[0] + 8]} /><meshBasicMaterial color="#ff2d3a" /></mesh>
      </group>
      {sectorPoses.map((p, i) => (
        <group key={i} position={[p.x, 0.12, -p.y]} rotation={[0, Math.atan2(p.ty, p.tx), 0]}>
          <mesh rotation={[-Math.PI / 2, 0, Math.PI / 2]}><planeGeometry args={[26, 1.2]} /><meshBasicMaterial color={i === 0 ? "#38d9f5" : "#ffb020"} /></mesh>
          <mesh position={[0, 3, 15]}><boxGeometry args={[0.6, 6, 0.6]} /><meshStandardMaterial color="#1c2028" /></mesh>
          <Html position={[0, 8, 15]} center zIndexRange={[5, 0]}>
            <div className="num text-[15px] px-2 border" style={{ color: i === 0 ? "#38d9f5" : "#ffb020", borderColor: "currentColor", background: "rgba(0,0,0,.6)" }}>
              S{i + 2}
            </div>
          </Html>
        </group>
      ))}

      {/* pit entry / exit signage */}
      <Html position={[pitIn.x, 9, -pitIn.y]} center zIndexRange={[5, 0]}>
        <div className="label !text-[10px] px-2 py-[1px]" style={{ background: "rgba(0,0,0,.65)", border: "1px solid #9a4655" }}>PIT ENTRY</div>
      </Html>
      <Html position={[pitOut.x, 9, -pitOut.y]} center zIndexRange={[5, 0]}>
        <div className="label !text-[10px] px-2 py-[1px]" style={{ background: "rgba(0,0,0,.65)", border: "1px solid #9a4655" }}>PIT EXIT</div>
      </Html>
      {proposing && (
        <Html position={[c.pitAt(c.pit.lineDist).x, 26, -c.pitAt(c.pit.lineDist).y]} center zIndexRange={[6, 0]}>
          <div className="num uppercase text-[18px] px-3 py-1 box-pulse whitespace-nowrap"
            style={{ background: "rgba(255,45,58,.9)", color: "#fff", letterSpacing: ".12em" }}>
            Proposed stop: {boxLabel}
          </div>
        </Html>
      )}

      {/* scenery */}
      <instancedMesh ref={foliage} args={[undefined, undefined, trees.length]} castShadow frustumCulled={false}>
        <coneGeometry args={[1, 1, 7]} /><meshStandardMaterial color="#1c4a26" roughness={1} />
      </instancedMesh>
      <instancedMesh ref={trunks} args={[undefined, undefined, trees.length]} frustumCulled={false}>
        <cylinderGeometry args={[1, 1, 1, 5]} /><meshStandardMaterial color="#3a2a1c" roughness={1} />
      </instancedMesh>
      {stands.map((s, i) => (
        <group key={i} position={[s.x, 0, s.z]} rotation={[0, s.yaw, 0]}>
          {[0, 1, 2, 3].map((r) => (
            <mesh key={r} position={[0, 1.6 + r * 2.2, -r * 2.6]} castShadow receiveShadow>
              <boxGeometry args={[s.len, 3.2, 3]} />
              <meshStandardMaterial color={s.color} roughness={0.8} />
            </mesh>
          ))}
          <mesh position={[0, 11, -4]} castShadow><boxGeometry args={[s.len + 2, 0.5, 14]} /><meshStandardMaterial color="#14171d" /></mesh>
          {Array.from({ length: Math.floor(s.len / 9) }, (_, k) => (
            <mesh key={k} position={[-s.len / 2 + 5 + k * 9, 10.5, -3]}><boxGeometry args={[0.4, 8, 0.4]} /><meshStandardMaterial color="#222731" /></mesh>
          ))}
        </group>
      ))}

      {/* labels for recognisable sections */}
      {lm.filter((l) => l.kind === "straight").map((l) => (
        <Html key={l.name} position={[l.x, 14, l.z]} center zIndexRange={[4, 0]}>
          <div className="label !text-[10px] whitespace-nowrap px-2" style={{ color: "#fff4f1", background: "rgba(0,0,0,.55)" }}>{l.name}</div>
        </Html>
      ))}
      {cornerLabels.map((k) => (
        <Html key={k.n} position={[k.x, 3, k.z]} center zIndexRange={[3, 0]}>
          <div className="text-[10px]" style={{ color: "#d3b5b9", textShadow: "0 0 4px #000" }}>T{k.n}</div>
        </Html>
      ))}
      {lm.filter((l) => l.kind === "corner").map((l) => (
        <Html key={l.name} position={[l.x, 20, l.z]} center zIndexRange={[4, 0]}>
          <div className="num uppercase text-[13px] whitespace-nowrap px-2" style={{ color: "#fff", background: "rgba(255,45,58,.75)" }}>{l.name}</div>
        </Html>
      ))}
    </group>
  );
}
