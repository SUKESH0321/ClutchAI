import { useMemo } from "react";
import { useTexture } from "@react-three/drei";
import * as THREE from "three";
import { pbr } from "../../lib/assets";

export interface WetUniform { value: number }

/** Load a Poly Haven PBR set (diffuse, normal, ARM) with repeat wrapping and the quality's anisotropy. */
export function usePbr(name: string, anisotropy: number) {
  const t = useTexture(pbr(name), (tex) => {
    const list = Array.isArray(tex) ? tex : [tex];
    for (const x of list) {
      x.wrapS = x.wrapT = THREE.RepeatWrapping;
      x.anisotropy = anisotropy;
    }
  }) as unknown as { map: THREE.Texture; normalMap: THREE.Texture; armMap: THREE.Texture };
  return t;
}

export interface PbrOptions {
  color?: THREE.ColorRepresentation;
  normalScale?: number;
  roughness?: number;
  /** replace roughness with this value scaled by the ARM map's green channel */
  side?: THREE.Side;
  vertexColors?: boolean;
  repeat?: [number, number];
}

/** MeshStandardMaterial from a PBR set. ARM: R = AO, G = roughness, B = metalness. */
export function makePbrMaterial(t: { map: THREE.Texture; normalMap: THREE.Texture; armMap: THREE.Texture }, o: PbrOptions = {}): THREE.MeshStandardMaterial {
  if (o.repeat) for (const x of [t.map, t.normalMap, t.armMap]) x.repeat.set(o.repeat[0], o.repeat[1]);
  const m = new THREE.MeshStandardMaterial({
    map: t.map,
    normalMap: t.normalMap,
    normalScale: new THREE.Vector2(o.normalScale ?? 1, o.normalScale ?? 1),
    roughnessMap: t.armMap,
    metalnessMap: t.armMap,
    aoMap: t.armMap,
    roughness: o.roughness ?? 1,
    metalness: 1,           // multiplied by the ARM blue channel
    color: o.color ?? 0xffffff,
    side: o.side ?? THREE.FrontSide,
    vertexColors: o.vertexColors ?? false,
  });
  return m;
}

const NOISE_GLSL = /* glsl */ `
float wHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float wNoise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(wHash(i), wHash(i+vec2(1,0)), f.x), mix(wHash(i+vec2(0,1)), wHash(i+vec2(1,1)), f.x), f.y);
}`;

/**
 * Make a material respond to track wetness. Driven by ONE uniform, so dry -> damp -> wet blends smoothly:
 *   - the surface darkens, grain flattens, roughness drops so the sky/HDRI reflects in it,
 *   - world-space noise breaks the wet film into puddles (lower roughness, flatter normals).
 */
export function patchWet(mat: THREE.MeshStandardMaterial, wet: WetUniform, opts: { puddles: number; darken: number; key: string }): void {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWet = wet as { value: number };
    shader.uniforms.uPuddles = { value: opts.puddles };
    shader.uniforms.uDarken = { value: opts.darken };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWPos;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\nvarying vec3 vWPos;\nuniform float uWet;\nuniform float uPuddles;\nuniform float uDarken;\n${NOISE_GLSL}`)
      .replace("#include <map_fragment>", `#include <map_fragment>
        float wetAmt = clamp(uWet * 1.25, 0.0, 1.0);
        float pud = smoothstep(0.46, 0.60, wNoise(vWPos.xz * 0.05) * 0.62 + wNoise(vWPos.xz * 0.16) * 0.38) * uPuddles;
        diffuseColor.rgb *= mix(1.0, uDarken, wetAmt) * mix(1.0, 0.82, pud * wetAmt);`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.05, clamp(wetAmt * (0.5 + 1.0 * pud), 0.0, 1.0));`)
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
        normal = normalize(mix(normal, nonPerturbedNormal, clamp(wetAmt * (0.35 + 0.65 * pud), 0.0, 0.92)));`);
  };
  mat.customProgramCacheKey = () => `wet-${opts.key}`;
  mat.needsUpdate = true;
}

export function useWetUniform(): WetUniform {
  return useMemo(() => ({ value: 0 }), []);
}
