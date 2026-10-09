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

  // corner apexes (local maxima of |curvature|) for the trackside corner camera
  const apexes = useMemo(() => {
    const out: { x: number; z: number; ox: number; oz: number }[] = [];
    let last = -1e9;
    for (let i = 0; i < c.n; i++) {
      const k = Math.abs(c.kappa[i]);
      const prev = Math.abs(c.kappa[(i - 1 + c.n) % c.n]), next = Math.abs(c.kappa[(i + 1) % c.n]);
      if (k > 0.006 && k >= prev && k >= next && i - last > 12) {
        last = i;
        const side = c.kappa[i] > 0 ? -1 : 1;                // outside of the bend
        const nx = -c.ty[i] * side, ny = c.tx[i] * side;
        out.push({ x: c.x[i], z: -c.y[i], ox: c.x[i] + nx * 38, oz: -(c.y[i] + ny * 38) });
      }
    }
    return out;
  }, [c]);
  const cornerIdx = useRef(-1);

  useEffect(() => {
    cornerIdx.current = -1;
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
      controls.current.enabled = mode !== "follow" && mode !== "chase" && mode !== "corner";
    }
  }, [mode, resetKey, view, aspect > 1.6 ? 2 : aspect > 1.2 ? 1 : 0]);  // eslint-disable-line react-hooks/exhaustive-deps

  useFrame((_, dt) => {
    const ctl = controls.current;
    if (!ctl) return;
    if (import.meta.env.DEV) { const w = window as unknown as { __controls?: unknown; __start?: unknown }; w.__controls = ctl; w.__start = c.pointAt(0); }
    if (mode === "corner") {
      const p = live.current.poses.get(followId);
      if (p && apexes.length) {
        const px = p.x, pz = -p.y;
        let cur = cornerIdx.current;
        const ahead = (a: { x: number; z: number }) => (a.x - px) * p.tx + (a.z - pz) * -p.ty;
        if (cur < 0 || ahead(apexes[cur]) < -70) {
          let best = -1, bd = 1e9;
          apexes.forEach((a, i) => { const d = Math.hypot(a.x - px, a.z - pz); if (ahead(a) > -20 && d < bd) { bd = d; best = i; } });
          cur = cornerIdx.current = best < 0 ? 0 : best;
        }
        const a = apexes[cur];
        const k = 1 - Math.exp(-3.5 * dt);
        camera.position.lerp(new THREE.Vector3(a.ox, 6, a.oz), k);
        ctl.target.lerp(new THREE.Vector3(px, 1.2, pz), k);
        ctl.update();
      }
      return;
    }
    if (mode === "follow" || mode === "chase") {
      const p = live.current.poses.get(followId);
      if (p) {
        const chase = mode === "chase";
        const pk = live.current.poses.get(followId)?.place;
        const stopped = pk?.kind === "pit" && pk.stopped;            // keep the camera clear of the pit crew while the car is serviced
        const back = stopped ? 9 : chase ? 9 : 19, up = stopped ? 4.5 : chase ? 2.4 : 7;
        const side = stopped ? 8 : 0;                                   // view the stop from the side, not through the rear jack
        const desired = new THREE.Vector3(p.x - p.tx * back + p.ty * side, Math.max(1.5, up), -(p.y - p.ty * back) + p.tx * side);
        const ahead = stopped ? 0 : chase ? 40 : 28;
        const look = new THREE.Vector3(p.x + p.tx * ahead, stopped ? 0.8 : chase ? 1.4 : 0.5, -(p.y + p.ty * ahead));
        const k = 1 - Math.exp(-(chase ? 7 : 5) * dt);
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
