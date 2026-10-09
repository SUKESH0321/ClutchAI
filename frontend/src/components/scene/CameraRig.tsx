import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { Circuit } from "../../lib/circuit";
import type { CamMode, LiveData } from "./live";

interface Props {
  circuit: Circuit;
  mode: CamMode;
  resetKey: number;
  followId: string;
  live: React.MutableRefObject<LiveData>;
}

export default function CameraRig({ circuit: c, mode, resetKey, followId, live }: Props) {
  const controls = useRef<OrbitControlsImpl>(null);
  const camera = useThree((s) => s.camera);
  const aspect = useThree((s) => s.size.width / Math.max(1, s.size.height));
  const transition = useRef(0);
  const goal = useRef({ pos: new THREE.Vector3(), look: new THREE.Vector3() });

  const view = useMemo(() => {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < c.n; i++) {
      minX = Math.min(minX, c.x[i]); maxX = Math.max(maxX, c.x[i]);
      minZ = Math.min(minZ, -c.y[i]); maxZ = Math.max(maxZ, -c.y[i]);
    }
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
    const r = Math.max(maxX - minX, maxZ - minZ);
    return { cx, cz, r };
  }, [c]);

  useEffect(() => {
    transition.current = 1.6; // seconds of smooth transition
    const { cx, cz } = view;
    const r = view.r * Math.max(1.14, 1.9 / aspect);   // keep the whole circuit in frame on narrow views
    if (mode === "cinematic") {
      goal.current.pos.set(cx - r * 0.22, r * 0.95, cz + r * 0.88);
      goal.current.look.set(cx, 0, cz);
    } else if (mode === "top") {
      goal.current.pos.set(cx, r * 1.12, cz + r * 0.06);
      goal.current.look.set(cx, 0, cz);
    }
    if (controls.current) {
      controls.current.enableRotate = mode !== "top";
      controls.current.enabled = mode !== "follow";
    }
  }, [mode, resetKey, view, aspect > 1.6 ? 2 : aspect > 1.2 ? 1 : 0]);  // eslint-disable-line react-hooks/exhaustive-deps

  useFrame((_, dt) => {
    const ctl = controls.current;
    if (!ctl) return;
    if (mode === "follow") {
      const p = live.current.poses.get(followId);
      if (p) {
        const back = 19, up = 7;
        const desired = new THREE.Vector3(p.x - p.tx * back, up, -(p.y - p.ty * back));
        const look = new THREE.Vector3(p.x + p.tx * 28, 0.5, -(p.y + p.ty * 28));
        const k = 1 - Math.exp(-5 * dt);
        camera.position.lerp(desired, k);
        ctl.target.lerp(look, k);
        ctl.update();
      }
      return;
    }
    if (transition.current > 0) {
      transition.current -= dt;
      const k = 1 - Math.exp(-4.5 * dt);
      camera.position.lerp(goal.current.pos, k);
      ctl.target.lerp(goal.current.look, k);
      ctl.update();
    }
  });

  return (
    <OrbitControls
      ref={controls as never}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      maxPolarAngle={Math.PI / 2.05}
      minDistance={25}
      maxDistance={4200}
      screenSpacePanning={false}
    />
  );
}
