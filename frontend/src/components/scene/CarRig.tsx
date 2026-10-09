import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF, Html } from "@react-three/drei";
import * as THREE from "three";
import { CAR_MODEL, F1_MODEL } from "../../lib/assets";
import { COMPOUND_COLOR } from "../../lib/compounds";
import type { Compound } from "../../types/race";
import { liveryPalette, numberTexture, type Livery } from "./livery";
import { Plume, type PlumeApi } from "./Plume";
import type { QualitySettings } from "../../lib/quality";

/**
 * Two car models share this rig:
 *  - "f1": the supplied open-wheel car (optimised by scripts/f1car; hi/lo detail swapped by camera distance), recoloured
 *    per team through a paint material + centre-stripe / front-wing secondary colour.
 *  - "race" / "race-future": the Kenney Car Kit cars (palette recoloured), used for the safety car and as a fallback.
 * Both expose wheel nodes named wheel-{front,back}-{left,right} (axle along X) and a "body" node.
 */
interface Spec {
  scale: number;
  wheelR: number;
  rearX: number;                 // rear of the car along the plume axis (+X = forward)
  frontX: number;
  lights: [number, number, number][];
  lightSize: [number, number, number];
  ringX: number;
  ringR: number;
  topDecal: { pos: [number, number, number]; size: number } | null;
  sideDecal: { x: number; y: number; z: number; size: number };
  labelY: [number, number];      // [primary, others]
}
const SPEC_KENNEY: Spec = {
  scale: 2.2, wheelR: 0.3 * 2.2, rearX: -2.5, frontX: 1.4,
  lights: [[-0.2, 0.36, -1.285], [0.2, 0.36, -1.285]], lightSize: [0.16, 0.06, 0.04],
  ringX: 0.302, ringR: 0.2,
  topDecal: { pos: [0, 0.636, -0.2], size: 0.3 }, sideDecal: { x: 0.606, y: 0.33, z: -0.1, size: 0.26 },
  labelY: [4.4, 3.6],
};
const SPEC_F1: Spec = {
  scale: 1, wheelR: 0.305, rearX: -2.95, frontX: 2.9,
  lights: [[-0.06, 0.5, -2.76], [0.06, 0.5, -2.76]], lightSize: [0.09, 0.05, 0.03],
  ringX: 0.16, ringR: 0.2,
  topDecal: { pos: [0, 0.58, 1.55], size: 0.2 }, sideDecal: { x: 0.672, y: 0.52, z: 0.15, size: 0.34 },
  labelY: [3.6, 3.0],
};

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

interface Variant { scene: THREE.Object3D; body: THREE.Object3D; wheels: Record<"fl" | "fr" | "bl" | "br", THREE.Object3D>; baseY: number }

function paintMaterial(l: Livery): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({ color: l.primary, roughness: 0.32, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.2 });
  const second = new THREE.Color(l.secondary);
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uSecond = { value: second };
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vOP;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvOP = position;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vOP;\nuniform vec3 uSecond;")
      .replace("#include <color_fragment>", `#include <color_fragment>
        float stripe = (1.0 - smoothstep(0.05, 0.075, abs(vOP.x))) * step(-0.9, vOP.z);
        float tip = smoothstep(2.05, 2.15, vOP.z);
        diffuseColor.rgb = mix(diffuseColor.rgb, uSecond, max(stripe, tip));`);
  };
  m.customProgramCacheKey = () => "f1-paint";
  return m;
}

export const CarRig = forwardRef<CarRigApi, Props>(function CarRig({ livery, label, primary, ghost = false, q, accent, onClick }, ref) {
  const isF1 = livery.model === "f1";
  const spec = isF1 ? SPEC_F1 : SPEC_KENNEY;
  const hiUrl = isF1 ? F1_MODEL("hi") : CAR_MODEL(livery.model as "race" | "race-future");
  const loUrl = isF1 ? F1_MODEL("lo") : hiUrl;
  const gHi = useGLTF(hiUrl);
  const gLo = useGLTF(loUrl);
  const root = useRef<THREE.Group>(null);
  const ring = useRef<THREE.Mesh>(null);
  const spray = useRef<PlumeApi>(null);
  const smoke = useRef<PlumeApi>(null);
  const sparks = useRef<PlumeApi>(null);

  const rig = useMemo(() => {
    const ghostMat = new THREE.MeshStandardMaterial({ color: "#ffffff", transparent: true, opacity: 0.28, depthWrite: false, roughness: 0.6 });
    const disposables: { dispose(): void }[] = [ghostMat];
    const track = <T extends { dispose(): void }>(o: T): T => { disposables.push(o); return o; };
    const variants: Variant[] = [];
    let paint: THREE.Material | null = null, carbon: THREE.Material | null = null, rubber: THREE.Material | null = null, kenney: THREE.Material | null = null;

    const prep = (src: THREE.Object3D): Variant => {
      const scene = src.clone(true);
      const body = scene.getObjectByName("body") as THREE.Object3D;
      const wheels = {
        fl: scene.getObjectByName("wheel-front-left")!, fr: scene.getObjectByName("wheel-front-right")!,
        bl: scene.getObjectByName("wheel-back-left")!, br: scene.getObjectByName("wheel-back-right")!,
      };
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const orig = m.material as THREE.MeshStandardMaterial;
        if (ghost) m.material = ghostMat;
        else if (isF1) {
          if (orig.name === "paint") m.material = paint ??= track(paintMaterial(livery));
          else if (orig.name === "rubber") m.material = rubber ??= track(new THREE.MeshStandardMaterial({ color: "#161616", roughness: 0.85, metalness: 0 }));
          else m.material = carbon ??= track(new THREE.MeshStandardMaterial({ color: "#1b1c20", roughness: 0.38, metalness: 0.55, envMapIntensity: 1.1 }));
        } else {
          if (!kenney) {
            const tex = orig.map ? liveryPalette(orig.map, livery) : null;
            kenney = new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.42, metalness: 0.08, clearcoat: 0.85, clearcoatRoughness: 0.12, envMapIntensity: 1.1 });
            disposables.push(kenney);
          }
          m.material = kenney;
        }
        m.castShadow = q.carShadows && !ghost; m.receiveShadow = !ghost;
      });
      for (const w of Object.values(wheels)) w.rotation.order = "YXZ";
      return { scene, body, wheels, baseY: body.position.y };
    };
    variants.push(prep(gHi.scene));
    if (isF1) variants.push(prep(gLo.scene));

    // brake lights on every variant (shared material), compound rings and number decals on the near model
    const brakeMat = new THREE.MeshStandardMaterial({ color: "#300", emissive: "#ff1a1a", emissiveIntensity: 0.4, roughness: 0.4 });
    const lightGeo = new THREE.BoxGeometry(...spec.lightSize);
    disposables.push(brakeMat, lightGeo);
    for (const v of variants) {
      for (const p of spec.lights) { const m = new THREE.Mesh(lightGeo, brakeMat); m.position.set(...p); v.body.add(m); }
    }
    const ringMat = new THREE.MeshBasicMaterial({ color: COMPOUND_COLOR.MEDIUM });
    const ringGeo = new THREE.TorusGeometry(spec.ringR, 0.018 / (isF1 ? 2.2 : 1), 6, 28); ringGeo.rotateY(Math.PI / 2);
    disposables.push(ringMat, ringGeo);
    if (!ghost) for (const v of variants) {
      (Object.entries(v.wheels) as [string, THREE.Object3D][]).forEach(([k, w]) => {
        const r = new THREE.Mesh(ringGeo, ringMat);
        r.position.x = k.endsWith("l") ? spec.ringX : -spec.ringX;
        w.add(r);
      });
    }
    if (!ghost) {
      const numMat = new THREE.MeshBasicMaterial({ map: numberTexture(livery.number), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
      const mk = (w: number) => new THREE.Mesh(new THREE.PlaneGeometry(w, w), numMat);
      const near = variants[0].body;
      if (spec.topDecal) { const top = mk(spec.topDecal.size); top.rotation.x = -Math.PI / 2; top.position.set(...spec.topDecal.pos); near.add(top); }
      for (const sgn of [-1, 1]) { const side = mk(spec.sideDecal.size); side.rotation.y = sgn * Math.PI / 2; side.position.set(sgn * spec.sideDecal.x, spec.sideDecal.y, spec.sideDecal.z); near.add(side); }
      disposables.push(numMat);
    }
    return { variants, brakeMat, ringMat, disposables };
  }, [gHi, gLo, livery.primary, livery.secondary, livery.number, livery.model, ghost, q.carShadows, isF1, spec]);

  const state = useRef({ roll: 0, pitch: 0, spin: 0, steer: 0, lastCompound: "" as string, bounce: 0, near: true });
  useEffect(() => () => { for (const d of rig.disposables) d.dispose(); }, [rig]);

  // swap to the low-poly model when the camera is far away (hysteresis avoids flicker at the boundary)
  const tmp = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera }) => {
    if (!isF1 || rig.variants.length < 2 || !root.current) return;
    root.current.getWorldPosition(tmp);
    const d = tmp.distanceTo(camera.position);
    const S = state.current;
    S.near = ghost ? false : S.near ? d < q.lod * 1.1 : d < q.lod * 0.9;
    rig.variants[0].scene.visible = S.near;
    rig.variants[1].scene.visible = !S.near;
  });

  useImperativeHandle(ref, () => ({
    get root() { return root.current!; },
    update(u: RigUpdate) {
      const S = state.current;
      const k = 1 - Math.exp(-u.dt * 9);
      // wheels: roll with the car's real speed, steer from track curvature
      S.spin += (u.speed * u.dt) / spec.wheelR;
      S.steer += (u.steer - S.steer) * (1 - Math.exp(-u.dt * 14));
      const wantPitch = THREE.MathUtils.clamp(u.brake * 0.035 - Math.max(0, u.pitLaunch) * 0.02, -0.03, 0.04);
      const wantRoll = THREE.MathUtils.clamp(u.latAccel * 0.0016, -0.05, 0.05);
      S.pitch += (wantPitch - S.pitch) * k; S.roll += (wantRoll - S.roll) * k;
      S.bounce += u.dt * (4 + u.speed * 0.05);
      const dy = -Math.min(0.025, u.speed * 0.0003) * (isF1 ? 0.45 : 1) + (u.speed > 5 ? Math.sin(S.bounce) * 0.004 * (isF1 ? 0.45 : 1) : 0);
      for (const v of rig.variants) {
        const { fl, fr, bl, br } = v.wheels;
        fl.rotation.x = fr.rotation.x = bl.rotation.x = br.rotation.x = S.spin;
        fl.rotation.y = fr.rotation.y = S.steer;
        v.body.rotation.x = S.pitch; v.body.rotation.z = S.roll;
        v.body.position.y = v.baseY + dy;
      }
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
  }), [rig, q.spray, ghost, spec, isF1]);

  const sprayCount = Math.min(90, Math.max(0, Math.round(q.spray / 8)));
  const ox = spec.rearX;
  return (
    <group ref={root} onClick={(e) => { e.stopPropagation(); onClick?.(); }}>
      <group rotation={[0, Math.PI / 2, 0]} scale={spec.scale}>
        {rig.variants.map((v, i) => <primitive key={i} object={v.scene} />)}
      </group>
      {sprayCount > 0 && <Plume ref={spray} count={sprayCount} color="#e6eef6" origin={[ox, 0.25, 0]} trail={6} rise={2.4} width={2.2} size={1.5} life={0.7} />}
      {!ghost && <Plume ref={smoke} count={26} color="#9ba1a9" origin={[ox - 0.1, 0.2, 0]} trail={5} rise={1.8} width={1.8} size={1.7} life={1.2} />}
      {!ghost && <Plume ref={sparks} count={22} color="#ffb347" origin={[spec.frontX - 1.5, 0.35, 0]} trail={2.8} rise={0.5} width={2.4} size={0.28} life={0.3} additive gravity={0.6} />}
      {!ghost && (
        <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 0]} visible={false}>
          <ringGeometry args={[3.4, 3.9, 48]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.9} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      )}
      {!ghost && (
        <Html position={[0, primary ? spec.labelY[0] : spec.labelY[1], 0]} center zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
          <div className={`num uppercase whitespace-nowrap leading-none ${primary ? "text-[17px] px-2 py-[2px]" : "text-[12px] px-[5px]"}`}
            style={{ background: primary ? "#ff2d3a" : "rgba(0,0,0,.65)", color: "#fff", border: `1px solid ${accent}` }}>
            {primary ? "STRATEGY CAR" : label}
          </div>
        </Html>
      )}
    </group>
  );
});
