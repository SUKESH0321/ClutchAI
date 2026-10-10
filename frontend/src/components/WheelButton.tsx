import { useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, Lightformer } from "@react-three/drei";
import * as THREE from "three";

interface Props {
  open: boolean;
  onClick: () => void;
  /** short live badge, e.g. "BOX" when the optimizer wants a stop */
  badge?: string | null;
}

/** Slick-tyre cross-section (radius, axial) revolved around the axle: wide flat tread, rounded shoulders, inset sidewall. */
const TYRE_PROFILE = [[0.6, -0.27], [0.7, -0.292], [0.86, -0.285], [0.955, -0.235], [0.995, -0.15], [1, -0.08], [1, 0.08], [0.995, 0.15],
  [0.955, 0.235], [0.86, 0.285], [0.7, 0.292], [0.6, 0.27]].map(([r, y]) => new THREE.Vector2(r, y));
const RIM_PROFILE = [[0.6, -0.24], [0.64, -0.25], [0.66, -0.2], [0.62, -0.1], [0.6, 0], [0.62, 0.1], [0.66, 0.2], [0.64, 0.25], [0.6, 0.24]]
  .map(([r, y]) => new THREE.Vector2(r, y));

function rubberBump(): THREE.CanvasTexture {
  const cv = document.createElement("canvas"); cv.width = cv.height = 128;
  const g = cv.getContext("2d")!;
  const img = g.createImageData(128, 128);
  for (let i = 0; i < img.data.length; i += 4) { const v = 120 + Math.random() * 70; img.data.set([v, v, v, 255], i); }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(10, 3);
  return t;
}

/** The wheel disc: a closed F1-style wheel cover with ten radial vents and a central lock nut. */
function faceGeometry(): THREE.ExtrudeGeometry {
  const s = new THREE.Shape(); s.absarc(0, 0, 0.6, 0, Math.PI * 2, false);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2, hole = new THREE.Path();
    const cx = Math.cos(a), cy = Math.sin(a), tx = -cy, ty = cx;
    const pt = (r: number, w: number) => [cx * r + tx * w, cy * r + ty * w] as const;
    hole.moveTo(...pt(0.26, -0.045)); hole.lineTo(...pt(0.5, -0.07)); hole.lineTo(...pt(0.5, 0.07)); hole.lineTo(...pt(0.26, 0.045)); hole.closePath();
    s.holes.push(hole);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 2, curveSegments: 40 });
  g.translate(0, 0, -0.1);
  return g;
}

function Wheel({ hovered, open }: { hovered: boolean; open: boolean }) {
  const root = useRef<THREE.Group>(null);
  const spin = useRef<THREE.Group>(null);
  const hub = useRef<THREE.MeshStandardMaterial>(null);
  const bump = useMemo(rubberBump, []);
  const face = useMemo(faceGeometry, []);
  const reduce = useMemo(() => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches, []);
  const state = useRef({ scale: 1, spin: 0 });
  useFrame(({ clock }, dt) => {
    const S = state.current;
    S.scale += ((hovered ? 1.09 : 1) - S.scale) * Math.min(1, dt * 9);
    S.spin += dt * (reduce ? 0 : hovered ? 1.6 : open ? 0.9 : 0.45);
    if (spin.current) spin.current.rotation.z = S.spin;
    if (root.current) {
      root.current.scale.setScalar(S.scale);
      root.current.position.y = reduce ? 0 : Math.sin(clock.elapsedTime * 1.7) * 0.035;
      root.current.rotation.y = -0.62 + (reduce ? 0 : Math.sin(clock.elapsedTime * 0.6) * 0.06);   // three-quarter view: sidewall and tread both visible
      root.current.rotation.x = 0.16;
    }
    if (hub.current) hub.current.emissiveIntensity = hovered ? 1.2 : open ? 0.8 : 0.35;
  });
  return (
    <group ref={root}>
      <group ref={spin}>
        {/* tyre: black slick with fine rubber grain */}
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <latheGeometry args={[TYRE_PROFILE, 72]} />
          <meshStandardMaterial color="#17181b" roughness={0.88} metalness={0.02} bumpMap={bump} bumpScale={0.6} side={THREE.DoubleSide} />
        </mesh>
        {/* sidewall compound band (red accent) and fine marking ring, both sides */}
        {[-1, 1].map((z) => (
          <group key={z} position={[0, 0, z * 0.2935]} rotation={[0, z > 0 ? 0 : Math.PI, 0]}>
            <mesh><ringGeometry args={[0.76, 0.83, 72]} /><meshStandardMaterial color="#ff2d3a" roughness={0.5} emissive="#b0101c" emissiveIntensity={0.5} /></mesh>
            <mesh position={[0, 0, 0.001]}><ringGeometry args={[0.855, 0.87, 72]} /><meshBasicMaterial color="#f2e6e6" transparent opacity={0.7} /></mesh>
          </group>
        ))}
        {/* rim barrel and lip */}
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <latheGeometry args={[RIM_PROFILE, 72]} />
          <meshStandardMaterial color="#c9ced6" metalness={1} roughness={0.22} side={THREE.DoubleSide} />
        </mesh>
        {/* wheel face (vented cover) */}
        <mesh geometry={face} position={[0, 0, 0.12]}>
          <meshStandardMaterial color="#8d939d" metalness={1} roughness={0.3} />
        </mesh>
        <mesh geometry={face} position={[0, 0, -0.1]} scale={[1, 1, -1]}>
          <meshStandardMaterial color="#6f757f" metalness={1} roughness={0.35} />
        </mesh>
        {/* hub: lock nut with red accent, drive pegs */}
        <mesh position={[0, 0, 0.19]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.16, 0.16, 0.1, 6]} />
          <meshStandardMaterial ref={hub} color="#e0202e" metalness={0.7} roughness={0.28} emissive="#ff2d3a" emissiveIntensity={0.35} />
        </mesh>
        <mesh position={[0, 0, 0.245]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.07, 0.07, 0.03, 24]} />
          <meshStandardMaterial color="#2a0d11" metalness={0.8} roughness={0.35} />
        </mesh>
        {[0, 1, 2].map((i) => (
          <mesh key={i} position={[Math.cos((i * 2 * Math.PI) / 3 + 0.5) * 0.27, Math.sin((i * 2 * Math.PI) / 3 + 0.5) * 0.27, 0.18]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.035, 0.035, 0.05, 12]} /><meshStandardMaterial color="#e6e8ec" metalness={1} roughness={0.2} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

/**
 * Floating race-control button: a real 3D Formula-style wheel (slick tyre with red compound band, vented metal wheel face,
 * red lock nut), lit by studio light panels. The canvas ignores the pointer; the <button> around it takes all input.
 */
export default function WheelButton({ open, onClick, badge }: Props) {
  const [hovered, setHovered] = useState(false);
  return (
    <div className="wheel-wrap">
      <button type="button" className="wheel-btn" onClick={onClick} aria-expanded={open} aria-controls="race-console"
        onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)} onFocus={() => setHovered(true)} onBlur={() => setHovered(false)}
        aria-label={open ? "Close race control and telemetry" : "Open race control and telemetry"}>
        <Canvas dpr={[1, 2]} camera={{ position: [0, 0, 4.1], fov: 34 }} gl={{ alpha: true, antialias: true }}
          style={{ pointerEvents: "none", background: "transparent" }}>
          <ambientLight intensity={0.25} />
          <directionalLight position={[2.5, 3, 4]} intensity={2.2} color="#fff1ee" />
          <pointLight position={[-3, -1.5, 2]} intensity={14} color="#ff3b47" distance={9} />
          <Environment resolution={128}>
            <Lightformer form="rect" intensity={3.2} position={[0, 3, 3]} scale={[7, 2, 1]} color="#ffffff" />
            <Lightformer form="rect" intensity={1.6} position={[-4, 0, 2]} scale={[2, 5, 1]} color="#ffb4b9" />
            <Lightformer form="rect" intensity={1.2} position={[4, -1, 1]} scale={[2, 4, 1]} color="#ffffff" />
            <Lightformer form="ring" intensity={1.2} position={[0, 0, -4]} scale={4} color="#ff3b47" />
          </Environment>
          <Wheel hovered={hovered} open={open} />
        </Canvas>
        {badge && (
          <span className="absolute -top-1 -right-2 num text-[12px] px-2 py-[1px] pulse-dot"
            style={{ background: "#ff3b47", color: "#fff", border: "1px solid #ffd0d4", letterSpacing: ".1em" }}>{badge}</span>
        )}
      </button>
      <span className="wheel-tip" role="tooltip">{open ? "Close console" : "Race Control & Telemetry"}</span>
    </div>
  );
}
