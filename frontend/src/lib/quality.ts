import { useSyncExternalStore } from "react";

/**
 * Rendering quality presets. Every field changes a real rendering cost or detail level; none is a label.
 * Default is "balanced": a good look on integrated GPUs while keeping the live race responsive.
 */
export type QualityLevel = "performance" | "balanced" | "high" | "ultra";

export interface QualitySettings {
  label: string;
  dpr: number;                 // max device pixel ratio
  shadows: boolean;
  shadowMapSize: number;
  shadowDistance: number;      // half-extent of the sun shadow frustum (m); smaller = sharper shadows
  anisotropy: number;          // texture anisotropic filtering
  terrainSegments: number;     // ground mesh resolution
  trees: number;
  crowd: number;               // spectators on the grandstands
  tyreWalls: number;           // number of tyre-wall sections
  props: number;               // 0..1 density of lamp posts, ad boards, fences
  spray: number;               // max rain-spray particles from cars
  rain: number;                // rain streaks
  hdrBackground: boolean;      // HDRI sky visible as the background
  reflections: boolean;        // environment-map reflections on the road, cars and wet surfaces
  fog: boolean;
  carShadows: boolean;
  skidDetail: boolean;
}

export const QUALITY: Record<QualityLevel, QualitySettings> = {
  performance: {
    label: "Performance", dpr: 1, shadows: false, shadowMapSize: 1024, shadowDistance: 0, anisotropy: 2,
    terrainSegments: 48, trees: 140, crowd: 0, tyreWalls: 2, props: 0.35, spray: 0, rain: 700,
    hdrBackground: true, reflections: false, fog: true, carShadows: false, skidDetail: false,
  },
  balanced: {
    label: "Balanced", dpr: 1.25, shadows: true, shadowMapSize: 2048, shadowDistance: 160, anisotropy: 4,
    terrainSegments: 96, trees: 320, crowd: 350, tyreWalls: 4, props: 0.65, spray: 160, rain: 1400,
    hdrBackground: true, reflections: true, fog: true, carShadows: true, skidDetail: false,
  },
  high: {
    label: "High", dpr: 1.6, shadows: true, shadowMapSize: 4096, shadowDistance: 220, anisotropy: 8,
    terrainSegments: 160, trees: 650, crowd: 900, tyreWalls: 7, props: 1, spray: 360, rain: 2400,
    hdrBackground: true, reflections: true, fog: true, carShadows: true, skidDetail: true,
  },
  ultra: {
    label: "Ultra", dpr: 2, shadows: true, shadowMapSize: 4096, shadowDistance: 300, anisotropy: 16,
    terrainSegments: 220, trees: 1100, crowd: 1800, tyreWalls: 10, props: 1, spray: 700, rain: 3600,
    hdrBackground: true, reflections: true, fog: true, carShadows: true, skidDetail: true,
  },
};

const KEY = "pitstop.quality";
const listeners = new Set<() => void>();
let current: QualityLevel = (() => {
  try {
    const v = localStorage.getItem(KEY) as QualityLevel | null;
    if (v && v in QUALITY) return v;
    const q = new URLSearchParams(window.location.search).get("quality");
    if (q === "low") return "performance";
    if (q && q in QUALITY) return q as QualityLevel;
  } catch {
    // storage unavailable: fall back to the default
  }
  return "balanced";
})();

export function setQuality(level: QualityLevel): void {
  current = level;
  try { localStorage.setItem(KEY, level); } catch { /* ignore */ }
  listeners.forEach((l) => l());
}

export function getQualityLevel(): QualityLevel {
  return current;
}

export function useQuality(): { level: QualityLevel; q: QualitySettings } {
  const level = useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => current,
  );
  return { level, q: QUALITY[level] };
}
