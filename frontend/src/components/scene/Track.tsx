import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import type { Circuit } from "../../lib/circuit";
import type { QualitySettings } from "../../lib/quality";
import type { Recommendation } from "../../types/race";
import { GlbObject } from "./glb";
import { KENNEY } from "../../lib/assets";
import { jerseyBarrierGeometry, kerbTexture, poseMatrix, type TrackGeometries } from "./trackGeometry";
import { makePbrMaterial, patchWet, usePbr, type WetUniform } from "./materials";
import type { LiveData } from "./live";
import { Safe } from "./Safe";

interface Props {
  circuit: Circuit;
  geo: TrackGeometries;
  live: React.MutableRefObject<LiveData>;
  q: QualitySettings;
  wet: WetUniform;
  reco: Recommendation | null;
  boxLabel: string;
}

function Instanced({ geometry, material, matrices, shadow = true, colors }: {
  geometry: THREE.BufferGeometry; material: THREE.Material; matrices: THREE.Matrix4[]; shadow?: boolean; colors?: THREE.Color[];
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const im = ref.current;
    if (!im) return;
    matrices.forEach((m, i) => { im.setMatrixAt(i, m); if (colors) im.setColorAt(i, colors[i]); });
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
  }, [matrices, colors]);
  if (!matrices.length) return null;
  return <instancedMesh key={matrices.length} ref={ref} args={[geometry, material, matrices.length]} castShadow={shadow} receiveShadow frustumCulled={false} />;
}

/** Tyre walls on the outside of the fastest corners: stacked tyres, painted white / black. */
function TyreWalls({ geo, circuit, q, rubber }: { geo: TrackGeometries; circuit: Circuit; q: QualitySettings; rubber: THREE.Material }) {
  const { matrices, colors } = useMemo(() => {
    const matrices: THREE.Matrix4[] = [], colors: THREE.Color[] = [];
    const dia = 0.66, len = 26;
    for (const site of geo.tyreWallSites.slice(0, q.tyreWalls)) {
      const cols = Math.round(len / dia);
      // march along the circuit around the wall's centre
      const centreF = (() => {
        let best = 0, bd = 1e9;
        for (let i = 0; i < circuit.n; i++) {
          const d = Math.hypot(circuit.x[i] - site.pose.x, circuit.y[i] - site.pose.y);
          if (d < bd) { bd = d; best = i; }
        }
        return best / circuit.n;
      })();
      for (let ci = 0; ci < cols; ci++) {
        const p = circuit.pointAt(((centreF + (ci * dia - len / 2) / circuit.length) % 1 + 1) % 1);
        for (let row = 0; row < 2; row++) {
          for (let h = 0; h < 3; h++) {
            const lat = site.lateral + (site.left ? -1 : 1) * row * dia;
            const m = poseMatrix(p, lat, 0.14 + h * 0.28);
            matrices.push(m);
            colors.push(new THREE.Color(ci % 6 < 2 ? "#e8e8e8" : "#1c1c1e"));
          }
        }
      }
    }
    return { matrices, colors };
  }, [geo, circuit, q.tyreWalls]);
  const geometry = useMemo(() => {
    const g = new THREE.TorusGeometry(0.25, 0.14, 8, 16);
    g.rotateX(Math.PI / 2);
    return g;
  }, []);
  return <Instanced geometry={geometry} material={rubber} matrices={matrices} colors={colors} />;
}

export default function Track({ circuit: c, geo, live, q, wet, reco, boxLabel }: Props) {
  const asphalt = usePbr("asphalt_track", q.anisotropy);
  const pit = usePbr("asphalt_pit_lane", q.anisotropy);
  const gravelT = usePbr("gravel_grass_path_3", q.anisotropy);
  const concrete = usePbr("concrete_floor_02", q.anisotropy);
  const rubberT = usePbr("rubber_tiles", q.anisotropy);
  const kerbTex = useMemo(() => kerbTexture(), []);
  const chequer = useMemo(() => {
    const cv = document.createElement("canvas"); cv.width = 64; cv.height = 8;
    const g = cv.getContext("2d")!;
    for (let x = 0; x < 16; x++) for (let y = 0; y < 2; y++) { g.fillStyle = (x + y) % 2 ? "#0b0b0b" : "#f4f4f4"; g.fillRect(x * 4, y * 4, 4, 4); }
    const t = new THREE.CanvasTexture(cv); t.magFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace; return t;
  }, []);

  const mats = useMemo(() => {
    const road = makePbrMaterial(asphalt, { normalScale: 1.1 });
    patchWet(road, wet, { puddles: 1, darken: 0.5, key: "road" });
    const runoff = makePbrMaterial(pit, { color: "#c9ccd2", normalScale: 1 });
    patchWet(runoff, wet, { puddles: 1, darken: 0.55, key: "runoff" });
    const pitLane = makePbrMaterial(pit, { normalScale: 1 });
    patchWet(pitLane, wet, { puddles: 0.8, darken: 0.55, key: "pit" });
    const gravel = makePbrMaterial(gravelT, { color: "#d8d0c0", normalScale: 1.4 });
    patchWet(gravel, wet, { puddles: 0.2, darken: 0.65, key: "gravel" });
    const kerb = new THREE.MeshStandardMaterial({ map: kerbTex, roughness: 0.55, metalness: 0 });
    patchWet(kerb, wet, { puddles: 0, darken: 0.8, key: "kerb" });
    const line = new THREE.MeshStandardMaterial({ color: "#ececec", roughness: 0.7 });
    patchWet(line, wet, { puddles: 0, darken: 0.85, key: "line" });
    const conc = makePbrMaterial(concrete, { repeat: [0.5, 0.5], normalScale: 1 });
    const rubber = makePbrMaterial(rubberT, { color: "#9a9a9a", repeat: [3, 1], normalScale: 1 });
    rubber.roughness = 0.95;
    return { road, runoff, pitLane, gravel, kerb, line, conc, rubber };
  }, [asphalt, pit, gravelT, concrete, rubberT, kerbTex, wet]);

  const pitGlow = useRef<THREE.MeshBasicMaterial>(null);
  const scGlow = useRef<THREE.MeshBasicMaterial>(null);
  const barrierGeo = useMemo(() => jerseyBarrierGeometry(), []);
  useEffect(() => () => { Object.values(mats).forEach((m) => m.dispose()); barrierGeo.dispose(); }, [mats, barrierGeo]);

  useFrame(({ clock }) => {
    const L = live.current;
    wet.value = L.wet;
    const t = clock.elapsedTime;
    if (scGlow.current) scGlow.current.opacity = L.safetyCar ? 0.45 + 0.4 * Math.sin(t * 6) : 0;
    const g = pitGlow.current;
    if (g) {
      const proposing = reco?.action === "BOX_THIS_LAP";
      const ph = L.primaryPit;
      if (ph === "stopped") { g.color.set("#22d37a"); g.opacity = 0.5; }
      else if (ph === "in" || ph === "out") { g.color.set("#22d37a"); g.opacity = 0.3; }
      else if (proposing) { g.color.set("#ff2d3a"); g.opacity = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(t * 7)); }
      else g.opacity = 0;
    }
  });

  const start = useMemo(() => c.pointAt(0), [c]);
  const sectorPoses = useMemo(() => c.data.sectors.fractions.slice(1).map((f) => c.pointAt(f)), [c]);
  const pitIn = useMemo(() => c.pitAt(0), [c]);
  const pitOut = useMemo(() => c.pitAt(c.pit.length), [c]);
  const pitLine = useMemo(() => c.pitAt(c.pit.lineDist), [c]);
  const lm = useMemo(() => c.data.landmarks.map((l) => {
    const i = ((l.index % c.n) + c.n) % c.n;
    return { name: l.name, x: c.x[i], z: -c.y[i], kind: l.kind };
  }), [c]);
  const cornerLabels = useMemo(() => c.data.corners.map((k) => {
    const i = k.index, nx = -c.ty[i], ny = c.tx[i], s = k.turn === "left" ? -1 : 1;
    const off = (s > 0 ? c.hl[i] : c.hr[i]) + 38;
    return { n: k.n, x: c.x[i] + nx * s * off, z: -(c.y[i] + ny * s * off) };
  }), [c]);
  const w0 = c.hl[0] + c.hr[0];
  const proposing = reco?.action === "BOX_THIS_LAP";

  return (
    <group>
      <mesh geometry={geo.road} material={mats.road} receiveShadow />
      <mesh geometry={geo.edgeL} material={mats.line} />
      <mesh geometry={geo.edgeR} material={mats.line} />
      <mesh geometry={geo.kerbs} material={mats.kerb} receiveShadow />
      <mesh geometry={geo.runoff} material={mats.runoff} receiveShadow />
      <mesh geometry={geo.gravel} material={mats.gravel} receiveShadow />
      <mesh geometry={geo.arrows}><meshBasicMaterial color="#ffffff" transparent opacity={0.2} side={THREE.DoubleSide} /></mesh>
      <mesh geometry={geo.scGlow}><meshBasicMaterial ref={scGlow} color="#ffb020" transparent opacity={0} side={THREE.DoubleSide} depthWrite={false} /></mesh>

      <mesh geometry={geo.pitLane} material={mats.pitLane} receiveShadow />
      <mesh geometry={geo.pitLine} material={mats.line} />
      <mesh geometry={geo.pitGlow}><meshBasicMaterial ref={pitGlow} color="#ff2d3a" transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} /></mesh>

      <Instanced geometry={barrierGeo} material={mats.conc} matrices={geo.barriers} />
      <Instanced geometry={barrierGeo} material={mats.conc} matrices={geo.pitWall} />
      <TyreWalls geo={geo} circuit={c} q={q} rubber={mats.rubber} />

      {/* start / finish line and gantry */}
      <group position={[start.x, 0.1, -start.y]} rotation={[0, Math.atan2(start.ty, start.tx), 0]}>
        <mesh rotation={[-Math.PI / 2, 0, Math.PI / 2]} position={[0, 0, (c.hl[0] - c.hr[0]) / 2]}>
          <planeGeometry args={[w0, 4]} />
          <meshBasicMaterial map={chequer} />
        </mesh>
      </group>
      <Safe name="start gantry">
        <GlbObject url={KENNEY("overhead")} size={w0 + 18} position={[start.x, 0, -start.y]}
          rotation={[0, Math.atan2(start.tx, -start.ty), 0]} scale={[1, 0.75, 1]} />
      </Safe>
      {sectorPoses.map((p, i) => (
        <group key={i} position={[p.x, 0.1, -p.y]} rotation={[0, Math.atan2(p.ty, p.tx), 0]}>
          <mesh rotation={[-Math.PI / 2, 0, Math.PI / 2]} position={[0, 0, (c.hl[0] - c.hr[0]) / 2]}>
            <planeGeometry args={[w0, 1.2]} />
            <meshBasicMaterial color={i === 0 ? "#38d9f5" : "#ffb020"} />
          </mesh>
          <Html position={[0, 9, c.hl[0] + 8]} center zIndexRange={[5, 0]}>
            <div className="num text-[15px] px-2 border" style={{ color: i === 0 ? "#38d9f5" : "#ffb020", borderColor: "currentColor", background: "rgba(0,0,0,.6)" }}>S{i + 2}</div>
          </Html>
        </group>
      ))}

      <Html position={[pitIn.x, 9, -pitIn.y]} center zIndexRange={[5, 0]}>
        <div className="label !text-[10px] px-2 py-[1px]" style={{ background: "rgba(0,0,0,.65)", border: "1px solid #9a4655" }}>PIT ENTRY</div>
      </Html>
      <Html position={[pitOut.x, 9, -pitOut.y]} center zIndexRange={[5, 0]}>
        <div className="label !text-[10px] px-2 py-[1px]" style={{ background: "rgba(0,0,0,.65)", border: "1px solid #9a4655" }}>PIT EXIT</div>
      </Html>
      {proposing && (
        <Html position={[pitLine.x, 26, -pitLine.y]} center zIndexRange={[6, 0]}>
          <div className="num uppercase text-[18px] px-3 py-1 box-pulse whitespace-nowrap"
            style={{ background: "rgba(255,45,58,.92)", color: "#fff", letterSpacing: ".12em" }}>Proposed stop: {boxLabel}</div>
        </Html>
      )}
      {lm.filter((l) => l.kind === "straight").map((l) => (
        <Html key={l.name} position={[l.x, 14, l.z]} center zIndexRange={[4, 0]}>
          <div className="label !text-[10px] whitespace-nowrap px-2" style={{ color: "#fff4f1", background: "rgba(0,0,0,.55)" }}>{l.name}</div>
        </Html>
      ))}
      {lm.filter((l) => l.kind === "corner").map((l) => (
        <Html key={l.name} position={[l.x, 20, l.z]} center zIndexRange={[4, 0]}>
          <div className="num uppercase text-[13px] whitespace-nowrap px-2" style={{ color: "#fff", background: "rgba(255,59,71,.78)" }}>{l.name}</div>
        </Html>
      ))}
      {cornerLabels.map((k) => (
        <Html key={k.n} position={[k.x, 3, k.z]} center zIndexRange={[3, 0]}>
          <div className="text-[10px]" style={{ color: "#e8d6d9", textShadow: "0 0 4px #000" }}>T{k.n}</div>
        </Html>
      ))}
    </group>
  );
}
