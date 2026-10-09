import { useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { PerformanceMonitor } from "@react-three/drei";
import * as THREE from "three";
import type { Circuit } from "../../lib/circuit";
import type { RaceClock } from "../../lib/raceClock";
import type { RaceState } from "../../types/race";
import CameraRig from "./CameraRig";
import Cars from "./Cars";
import Environment from "./Environment";
import Rain from "./Rain";
import type { CamMode, LiveData } from "./live";

interface Props {
  circuit: Circuit;
  state: RaceState;
  clock: RaceClock;
  live: React.MutableRefObject<LiveData>;
  mode: CamMode;
  resetKey: number;
  selectedId: string;
  followId: string;
  onSelect: (id: string) => void;
  boxLabel: string;
  drawerOpen: boolean;
}

/** Slides the rendered view up (a little when closed, more while the console is open). No resize, no geometry change. */
function ViewShift({ open }: { open: boolean }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const cur = useRef(0);
  useFrame((_, dt) => {
    const target = size.height * (open ? 0.22 : 0.07);
    const prev = cur.current;
    cur.current += (target - cur.current) * (1 - Math.exp(-6 * dt));
    if (Math.abs(cur.current - prev) < 0.01 && camera.view?.enabled && Math.abs(cur.current - target) < 0.5) return; // settled
    camera.setViewOffset(size.width, size.height, 0, cur.current, size.width, size.height);
  });
  return null;
}

export default function Scene3D(p: Props) {
  const { circuit: c } = p;
  const r = 1800;
  const low = new URLSearchParams(window.location.search).get("quality") === "low";
  const [dpr, setDpr] = useState(low ? 1 : 1.5);   // adapts down if the frame rate drops
  return (
    <Canvas
      shadows={!low}
      dpr={dpr}
      camera={{ fov: 42, near: 1, far: 9000, position: [-300, 1700, 2200] }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      onCreated={({ gl, scene }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.05;
        scene.background = new THREE.Color("#2a0a10");
        scene.fog = new THREE.FogExp2("#2a0a10", 0.00019);
      }}
    >
      <ViewShift open={p.drawerOpen} />
      <PerformanceMonitor onDecline={() => setDpr(1)} onIncline={() => !low && setDpr(1.5)} />
      <hemisphereLight args={["#a9c4ea", "#2b4a26", 1.15]} />
      <ambientLight intensity={0.45} />
      <directionalLight
        position={[900, 1100, 500]} intensity={2.1} color="#ffe2c0" castShadow
        shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004}
        shadow-camera-left={-r} shadow-camera-right={r} shadow-camera-top={r} shadow-camera-bottom={-r}
        shadow-camera-near={10} shadow-camera-far={3500}
      />
      <Environment circuit={c} live={p.live} reco={p.state.recommendation} boxLabel={p.boxLabel} />
      <Cars circuit={c} state={p.state} clock={p.clock} live={p.live} selectedId={p.selectedId} onSelect={p.onSelect} />
      <Rain live={p.live} />
      <CameraRig circuit={c} mode={p.mode} resetKey={p.resetKey} followId={p.followId} live={p.live} />
    </Canvas>
  );
}
