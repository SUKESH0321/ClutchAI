import * as THREE from "three";
import type { Circuit } from "./circuit";

/**
 * Low-frequency terrain around the circuit. The circuit itself is flat (the source data has no elevation),
 * so height is forced to zero near the track and rises smoothly with distance: gentle hills as a backdrop.
 */
function hash(ix: number, iz: number): number {
  const s = Math.sin(ix * 127.1 + iz * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x: number, z: number): number {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}
function fbm(x: number, z: number): number {
  return 0.55 * vnoise(x, z) + 0.28 * vnoise(x * 2.1, z * 2.1) + 0.17 * vnoise(x * 4.3, z * 4.3);
}
const smooth = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export interface Terrain {
  geometry: THREE.BufferGeometry;
  heightAt: (x: number, z: number) => number;
  size: number;
}

export function makeTerrain(c: Circuit, segments: number, size = 7000): Terrain {
  const distCache = new Map<string, number>();
  const dist = (x: number, z: number) => {
    const key = `${Math.round(x / 8)},${Math.round(z / 8)}`;
    let d = distCache.get(key);
    if (d === undefined) { d = c.distanceToTrack(x, -z); distCache.set(key, d); }
    return d;
  };
  const heightAt = (x: number, z: number): number => {
    const d = dist(x, z);
    const far = smooth(140, 520, d);
    if (far <= 0) return 0;
    const hills = (fbm(x * 0.0011 + 11.3, z * 0.0011 + 4.1) - 0.38) * 70;
    const swell = (fbm(x * 0.006, z * 0.006) - 0.4) * 9;
    return far * Math.max(-3, hills + swell * far);
  };

  const geo = new THREE.PlaneGeometry(size, size, segments, segments);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)) - 0.2);
  geo.computeVertexNormals();
  // UVs in metres so the grass texture tiles at a fixed physical size
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / 14, pos.getZ(i) / 14);
  return { geometry: geo, heightAt, size };
}
