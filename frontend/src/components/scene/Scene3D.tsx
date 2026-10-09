import { useEffect, useRef, useState } from "react";
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
import { useQuality } from "../../lib/quality";
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
  const { q } = useQuality();
  const [dpr, setDpr] = useState(q.dpr);
  useEffect(() => setDpr(q.dpr), [q.dpr]);
  return (
    <Canvas
      key={`${q.shadows}-${q.shadowMapSize}`}   // recreate the GL context when shadow capability changes
      shadows={q.shadows ? "soft" : false}
      dpr={Math.min(dpr, window.devicePixelRatio || 1) || 1}
      camera={{ fov: 42, near: 0.5, far: 12000, position: [-300, 1700, 2200] }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      onCreated={({ gl, scene, camera }) => {
        if (import.meta.env.DEV) (window as unknown as { __three: unknown }).__three = { scene, camera, gl };
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 0.9;
        gl.outputColorSpace = THREE.SRGBColorSpace;
        scene.background = new THREE.Color("#9db7d6");
      }}
    >
      <ViewShift open={p.drawerOpen} />
      <PerformanceMonitor onDecline={() => setDpr((d) => Math.max(1, d - 0.4))} onIncline={() => setDpr(q.dpr)} />
      <Environment circuit={c} live={p.live} reco={p.state.recommendation} boxLabel={p.boxLabel} q={q} />
      <Cars circuit={c} state={p.state} clock={p.clock} live={p.live} selectedId={p.selectedId} onSelect={p.onSelect} q={q} />
      <Rain live={p.live} q={q} />
      <CameraRig circuit={c} mode={p.mode} resetKey={p.resetKey} followId={p.followId} live={p.live} />
    </Canvas>
  );
}
