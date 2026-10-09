import { useEffect, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Environment } from "@react-three/drei";
import * as THREE from "three";
import { SKY } from "../../lib/assets";
import type { QualitySettings } from "../../lib/quality";
import type { LiveData } from "./live";

const DRY_FOG = new THREE.Color("#b9cde6");
const WET_FOG = new THREE.Color("#7b8591");
const SUN_DRY = new THREE.Color("#fff1da");
const SUN_WET = new THREE.Color("#c4cfdc");

/**
 * HDRI sky + sun + fog. Everything follows the SMOOTHED wetness from the simulation: the sun fades, the sky
 * switches to an overcast HDRI (with a short cross-fade), fog thickens. Shadows follow the camera focus.
 */
export default function Sky({ live, q }: { live: React.MutableRefObject<LiveData>; q: QualitySettings }) {
  const { scene } = useThree();
  const sun = useRef<THREE.DirectionalLight>(null);
  const [env, setEnv] = useState<"dry" | "wet">("dry");
  const fade = useRef(1);           // 0..1 intensity multiplier used for the HDRI cross-fade
  const want = useRef<"dry" | "wet">("dry");
  const fog = useRef<THREE.Fog>(null);

  useEffect(() => {
    scene.fog = fog.current;
    return () => { scene.fog = null; };
  }, [scene, q.fog]);

  useEffect(() => {
    const s = sun.current;
    if (!s) return;
    scene.add(s.target);
    s.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
    s.shadow.map?.dispose();
    (s.shadow as unknown as { map: THREE.WebGLRenderTarget | null }).map = null;
    const d = q.shadowDistance;
    const cam = s.shadow.camera as THREE.OrthographicCamera;
    cam.left = -d; cam.right = d; cam.top = d; cam.bottom = -d; cam.near = 10; cam.far = 1400;
    cam.updateProjectionMatrix();
    return () => { scene.remove(s.target); };
  }, [scene, q.shadowMapSize, q.shadowDistance]);

  useFrame((_, dt) => {
    const L = live.current;
    const w = L.wet;
    // pick the HDRI with hysteresis, cross-fade through darkness
    if (want.current === "dry" && w > 0.4) want.current = "wet";
    else if (want.current === "wet" && w < 0.25) want.current = "dry";
    if (want.current !== env) {
      fade.current = Math.max(0, fade.current - dt * 3.5);
      if (fade.current <= 0.02) setEnv(want.current);
    } else fade.current = Math.min(1, fade.current + dt * 2.5);

    const dim = 1 - 0.18 * w;
    scene.environmentIntensity = (q.reflections ? 1.0 : 0.55) * dim * fade.current;
    scene.backgroundIntensity = (0.95 - 0.05 * w) * fade.current;

    const f = fog.current;
    if (f) {
      f.color.copy(DRY_FOG).lerp(WET_FOG, w);
      f.near = 2200 - 1200 * w;
      f.far = 10000 - 5500 * w;
    }
    const s = sun.current;
    if (s) {
      s.intensity = THREE.MathUtils.lerp(3.2, 1.3, Math.min(1, w * 1.1));
      s.color.copy(SUN_DRY).lerp(SUN_WET, w);
      const dir = new THREE.Vector3(0.55, 0.78, 0.32).normalize();
      s.position.set(L.focus.x + dir.x * 700, dir.y * 700, L.focus.z + dir.z * 700);
      s.target.position.set(L.focus.x, 0, L.focus.z);
      s.target.updateMatrixWorld();
    }
  });

  return (
    <>
      {q.fog && <fog ref={fog} attach="fog" args={["#b9cde6", 2200, 10000]} />}
      <Environment key={env} files={env === "dry" ? SKY.dry : SKY.wet} background={q.hdrBackground} />
      <hemisphereLight args={["#cfe0f5", "#4a5a3a", 0.35]} />
      <directionalLight
        ref={sun}
        castShadow={q.shadows}
        intensity={3.2}
        shadow-bias={-0.00025}
        shadow-normalBias={0.35}
      />
    </>
  );
}
