import { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

export interface PlumeApi { intensity: number }

interface Props {
  count: number;
  color: THREE.ColorRepresentation;
  /** where the plume starts, relative to the car (metres, +X = forward), and how far it trails */
  origin: [number, number, number];
  trail: number;
  rise: number;
  width: number;
  size: number;
  life?: number;          // seconds for a particle to cross the plume
  additive?: boolean;
  gravity?: number;
}

const VERT = /* glsl */ `
attribute float aAlpha; attribute float aSize; varying float vAlpha; uniform float uScale;
void main(){
  vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = clamp(aSize * uScale / max(0.1, -mv.z), 1.0, 96.0);
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = /* glsl */ `
precision mediump float; varying float vAlpha; uniform vec3 uColor;
void main(){
  vec2 d = gl_PointCoord - 0.5; float r = length(d) * 2.0;
  float a = smoothstep(1.0, 0.0, r) * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor, a);
}`;

/**
 * A short particle plume that travels WITH the car (local space). The simulation is time-compressed, so world-space
 * trails would smear across hundreds of metres; a plume reads correctly at any simulation speed.
 * Intensity (0..1) is set each frame by the owner from real state (wetness x speed, pit-lane braking, ...).
 */
export const Plume = forwardRef<PlumeApi, Props>(function Plume(p, ref) {
  const api = useRef<PlumeApi>({ intensity: 0 });
  useImperativeHandle(ref, () => api.current, []);
  const { geo, mat, seeds } = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(p.count * 3), 3));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(new Float32Array(p.count), 1));
    geo.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array(p.count), 1));
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      blending: p.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uScale: { value: 800 }, uColor: { value: new THREE.Color(p.color) } },
    });
    const seeds = Array.from({ length: p.count }, (_, i) => ({ ph: i / p.count, rx: Math.random() - 0.5, ry: Math.random(), rz: Math.random() - 0.5 }));
    return { geo, mat, seeds };
  }, [p.count, p.color, p.additive]);
  const pts = useRef<THREE.Points>(null);

  useFrame(({ clock, camera, size }) => {
    const I = api.current.intensity;
    const obj = pts.current;
    if (!obj) return;
    obj.visible = I > 0.02;
    if (!obj.visible) return;
    const cam = camera as THREE.PerspectiveCamera;
    mat.uniforms.uScale.value = (size.height * 0.5) / Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const al = geo.attributes.aAlpha as THREE.BufferAttribute;
    const sz = geo.attributes.aSize as THREE.BufferAttribute;
    const t = clock.elapsedTime / (p.life ?? 0.9);
    for (let i = 0; i < p.count; i++) {
      const s = seeds[i];
      const ph = (t + s.ph) % 1;
      pos.setXYZ(i,
        p.origin[0] - ph * p.trail,
        p.origin[1] + ph * p.rise * (0.5 + s.ry) - (p.gravity ?? 0) * ph * ph,
        p.origin[2] + s.rz * p.width * (0.4 + ph));
      al.setX(i, (1 - ph) * (1 - ph) * I * 0.55);
      sz.setX(i, p.size * (0.6 + ph * 1.8) * (0.7 + s.ry * 0.6));
    }
    pos.needsUpdate = true; al.needsUpdate = true; sz.needsUpdate = true;
  });

  return <points ref={pts} geometry={geo} material={mat} frustumCulled={false} />;
});
