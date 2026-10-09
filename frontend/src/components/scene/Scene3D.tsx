import { useState } from "react";
import { Canvas } from "@react-three/fiber";
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
        scene.background = new THREE.Color("#0a0e15");
        scene.fog = new THREE.FogExp2("#0a0e15", 0.00007);
      }}
    >
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
