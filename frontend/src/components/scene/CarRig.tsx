import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { useGLTF, Html } from "@react-three/drei";
import * as THREE from "three";
import { CAR_MODEL } from "../../lib/assets";
import { COMPOUND_COLOR } from "../../lib/compounds";
import type { Compound } from "../../types/race";
import { liveryPalette, numberTexture, type Livery } from "./livery";
import { Plume, type PlumeApi } from "./Plume";
import type { QualitySettings } from "../../lib/quality";

/** The Kenney race car is 2.56 units long (+Z is the nose); scale to a ~5.6 m racing car. */
const MODEL_SCALE = 2.2;
const WHEEL_R = 0.3 * MODEL_SCALE;   // metres

export interface RigUpdate {
  dt: number;            // wall-clock seconds since the last frame
  speed: number;         // m/s (authoritative distance / time)
  brake: number;         // 0..1
  steer: number;         // radians (front wheels)
  latAccel: number;      // m/s^2, positive = turning left
  wet: number;           // 0..1
  pit: "none" | "in" | "stopped" | "out";
  compound: Compound;
  pitLaunch: number;     // 0..1 acceleration out of the box
}

export interface CarRigApi {
  root: THREE.Group;
  update(u: RigUpdate): void;
  setSelected(v: boolean): void;
  setScale(s: number): void;
}

interface Props {
  livery: Livery;
  label: string;
  primary: boolean;
  ghost?: boolean;
  q: QualitySettings;
  accent: string;
  onClick?: () => void;
}

export const CarRig = forwardRef<CarRigApi, Props>(function CarRig({ livery, label, primary, ghost = false, q, accent, onClick }, ref) {
  const gltf = useGLTF(CAR_MODEL(livery.model));
  const root = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const spray = useRef<PlumeApi>(null);
  const smoke = useRef<PlumeApi>(null);
  const sparks = useRef<PlumeApi>(null);

  const rig = useMemo(() => {
    const scene = gltf.scene.clone(true);
    const body = scene.getObjectByName("body") as THREE.Object3D;
    const wheels = {
      fl: scene.getObjectByName("wheel-front-left")!, fr: scene.getObjectByName("wheel-front-right")!,
      bl: scene.getObjectByName("wheel-back-left")!, br: scene.getObjectByName("wheel-back-right")!,
    };
    // palette-recoloured material shared by body and wheels
    let source: THREE.Texture | null = null;
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !source) source = (m.material as THREE.MeshStandardMaterial).map;
    });
    const tex = source ? liveryPalette(source, livery) : null;
    const mat = ghost
      ? new THREE.MeshStandardMaterial({ color: "#ffffff", transparent: true, opacity: 0.28, depthWrite: false, roughness: 0.6 })
      : new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.42, metalness: 0.08, clearcoat: 0.85, clearcoatRoughness: 0.12, envMapIntensity: 1.1 });
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.material = mat; m.castShadow = q.carShadows && !ghost; m.receiveShadow = !ghost;
    });
    for (const w of Object.values(wheels)) w.rotation.order = "YXZ";
    const baseY = body.position.y;

    // brake lights (rear), compound rings on the wheels, number decals
    const brakeMat = new THREE.MeshStandardMaterial({ color: "#300", emissive: "#ff1a1a", emissiveIntensity: 0.4, roughness: 0.4 });
    const lights = [-0.2, 0.2].map((x) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 0.04), brakeMat);
      m.position.set(x, 0.36, -1.285);
      body.add(m);
      return m;
    });
    const ringMat = new THREE.MeshBasicMaterial({ color: COMPOUND_COLOR.MEDIUM });
    const ringGeo = new THREE.TorusGeometry(0.2, 0.018, 6, 28); ringGeo.rotateY(Math.PI / 2);
    (Object.entries(wheels) as [string, THREE.Object3D][]).forEach(([k, w]) => {
      const r = new THREE.Mesh(ringGeo, ringMat);
      r.position.x = k.endsWith("l") ? 0.302 : -0.302;
      w.add(r);
    });
    if (!ghost) {
      const numMat = new THREE.MeshBasicMaterial({ map: numberTexture(livery.number), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
      const mk = (w: number) => new THREE.Mesh(new THREE.PlaneGeometry(w, w), numMat);
      const top = mk(0.3); top.rotation.x = -Math.PI / 2; top.position.set(0, 0.636, -0.2); body.add(top);
      for (const sgn of [-1, 1]) { const side = mk(0.26); side.rotation.y = sgn * Math.PI / 2; side.position.set(sgn * 0.606, 0.33, -0.1); body.add(side); }
    }
    return { scene, body, wheels, baseY, brakeMat, ringMat, mat, lights };
  }, [gltf, livery.primary, livery.secondary, livery.number, livery.model, ghost, q.carShadows]);

  const state = useRef({ roll: 0, pitch: 0, spin: 0, steer: 0, y: 0, lastCompound: "" as string, bounce: 0 });
  useEffect(() => () => { rig.mat.dispose(); rig.brakeMat.dispose(); rig.ringMat.dispose(); }, [rig]);

  useImperativeHandle(ref, () => ({
    get root() { return root.current!; },
    update(u: RigUpdate) {
      const S = state.current;
      const k = 1 - Math.exp(-u.dt * 9);
      // wheels: roll with the car's real speed, steer from track curvature
      S.spin += (u.speed * u.dt) / WHEEL_R;
      S.steer += (u.steer - S.steer) * (1 - Math.exp(-u.dt * 14));
      const { fl, fr, bl, br } = rig.wheels;
      fl.rotation.x = fr.rotation.x = bl.rotation.x = br.rotation.x = S.spin;
      fl.rotation.y = fr.rotation.y = S.steer;
      // body: pitch with braking, roll with lateral acceleration, a little ride-height change with speed
      const wantPitch = THREE.MathUtils.clamp(u.brake * 0.035 - Math.max(0, u.pitLaunch) * 0.02, -0.03, 0.04);
      const wantRoll = THREE.MathUtils.clamp(u.latAccel * 0.0016, -0.05, 0.05);
      S.pitch += (wantPitch - S.pitch) * k; S.roll += (wantRoll - S.roll) * k;
      rig.body.rotation.x = S.pitch; rig.body.rotation.z = S.roll;
      S.bounce += u.dt * (4 + u.speed * 0.05);
      rig.body.position.y = rig.baseY - Math.min(0.025, u.speed * 0.0003) + (u.speed > 5 ? Math.sin(S.bounce) * 0.004 : 0);
      // lights
      const braking = Math.max(u.brake, u.pit === "stopped" ? 1 : 0);
      rig.brakeMat.emissiveIntensity = 0.5 + braking * 4.5 + u.wet * 1.2;
      // tyre compound ring (changes when the stop completes)
      if (S.lastCompound !== u.compound) { rig.ringMat.color.set(COMPOUND_COLOR[u.compound]); S.lastCompound = u.compound; }
      // effects driven by real state
      const I_spray = q.spray > 0 ? THREE.MathUtils.clamp((u.wet - 0.22) * 2.2, 0, 1) * THREE.MathUtils.clamp(u.speed / 55, 0, 1) : 0;
      if (spray.current) spray.current.intensity = ghost ? 0 : I_spray;
      const braking_in_pit = u.pit === "in" ? THREE.MathUtils.clamp(u.brake * 1.2, 0, 1) : 0;
      if (smoke.current) smoke.current.intensity = ghost ? 0 : Math.max(braking_in_pit, u.pit === "out" ? u.pitLaunch : 0) * 0.8;
      if (sparks.current) sparks.current.intensity = !ghost && u.pit === "stopped" ? 0.5 + 0.5 * Math.sin(S.spin * 7) : 0;
    },
    setSelected(v: boolean) { if (ring.current) ring.current.visible = v; },
    setScale(s: number) { root.current?.scale.setScalar(s); },
  }), [rig, q.spray, ghost]);

  const sprayCount = Math.min(90, Math.max(0, Math.round(q.spray / 8)));
  return (
    <group ref={root} onClick={(e) => { e.stopPropagation(); onClick?.(); }}>
      <group rotation={[0, Math.PI / 2, 0]} scale={MODEL_SCALE}>
        <primitive object={rig.scene} />
      </group>
      {sprayCount > 0 && <Plume ref={spray} count={sprayCount} color="#e6eef6" origin={[-2.5, 0.25, 0]} trail={6} rise={2.4} width={2.2} size={1.5} life={0.7} />}
      {!ghost && <Plume ref={smoke} count={26} color="#9ba1a9" origin={[-2.6, 0.2, 0]} trail={5} rise={1.8} width={1.8} size={1.7} life={1.2} />}
      {!ghost && <Plume ref={sparks} count={22} color="#ffb347" origin={[1.4, 0.35, 0]} trail={2.8} rise={0.5} width={2.4} size={0.28} life={0.3} additive gravity={0.6} />}
      {!ghost && (
        <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 0]} visible={false}>
          <ringGeometry args={[3.4, 3.9, 48]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.9} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      )}
      {!ghost && (
        <Html position={[0, primary ? 4.4 : 3.6, 0]} center zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
          <div className={`num uppercase whitespace-nowrap leading-none ${primary ? "text-[17px] px-2 py-[2px]" : "text-[12px] px-[5px]"}`}
            style={{ background: primary ? "#ff2d3a" : "rgba(0,0,0,.65)", color: "#fff", border: `1px solid ${accent}` }}>
            {primary ? "STRATEGY CAR" : label}
          </div>
        </Html>
      )}
    </group>
  );
});
