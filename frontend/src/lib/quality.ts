import { useSyncExternalStore } from "react";

/**
 * Rendering quality presets. Every field changes a real rendering cost or detail level; none is a label.
 * Default is "balanced": a good look on integrated GPUs while keeping the live race responsive.
 */
export type QualityLevel = "performance" | "balanced" | "high" | "ultra";

/** Vegetation density: separate from the graphics preset, so a weak GPU can keep a lush venue or a strong one drop it. */
export type VegLevel = "low" | "medium" | "high" | "ultra";
export interface VegSettings {
  trees: number;        // tree instances placed around the circuit
  bushes: number;       // bush / low-vegetation instances
  hiRadius: number;     // metres from the camera within which the detailed tree models are drawn (beyond: 50-triangle stand-ins)
  bushRadius: number;   // metres within which bushes are drawn
  wind: boolean;        // vertex sway
}
export const VEGETATION: Record<VegLevel, VegSettings> = {
  low:    { trees: 3500,  bushes: 2000,  hiRadius: 200, bushRadius: 180, wind: false },
  medium: { trees: 11000, bushes: 7000,  hiRadius: 300, bushRadius: 280, wind: true },
  high:   { trees: 24000, bushes: 14000, hiRadius: 440, bushRadius: 400, wind: true },
  ultra:  { trees: 42000, bushes: 24000, hiRadius: 620, bushRadius: 560, wind: true },
};
export const VEG_LEVELS = Object.keys(VEGETATION) as VegLevel[];
const PRESET_VEG: Record<QualityLevel, VegLevel> = { performance: "low", balanced: "medium", high: "high", ultra: "ultra" };

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
  lod: number;                 // distance (m) beyond which cars switch to the low-poly model
  vegLevel: VegLevel;          // resolved vegetation density (preset default unless overridden)
  veg: VegSettings;
}

type BaseQuality = Omit<QualitySettings, "vegLevel" | "veg">;
const BASE: Record<QualityLevel, BaseQuality> = {
  performance: {
    label: "Performance", dpr: 1, shadows: false, shadowMapSize: 1024, shadowDistance: 0, anisotropy: 2,
    terrainSegments: 48, trees: 140, crowd: 0, tyreWalls: 2, props: 0.35, spray: 0, rain: 700,
    hdrBackground: true, reflections: false, fog: true, carShadows: false, skidDetail: false, lod: 60,
  },
  balanced: {
    label: "Balanced", dpr: 1.25, shadows: true, shadowMapSize: 2048, shadowDistance: 160, anisotropy: 4,
    terrainSegments: 96, trees: 320, crowd: 350, tyreWalls: 4, props: 0.65, spray: 160, rain: 1400,
    hdrBackground: true, reflections: true, fog: true, carShadows: true, skidDetail: false, lod: 110,
  },
  high: {
    label: "High", dpr: 1.6, shadows: true, shadowMapSize: 4096, shadowDistance: 220, anisotropy: 8,
    terrainSegments: 160, trees: 650, crowd: 900, tyreWalls: 7, props: 1, spray: 360, rain: 2400,
    hdrBackground: true, reflections: true, fog: true, carShadows: true, skidDetail: true, lod: 180,
  },
  ultra: {
    label: "Ultra", dpr: 2, shadows: true, shadowMapSize: 4096, shadowDistance: 300, anisotropy: 16,
    terrainSegments: 220, trees: 1100, crowd: 1800, tyreWalls: 10, props: 1, spray: 700, rain: 3600,
    hdrBackground: true, reflections: true, fog: true, carShadows: true, skidDetail: true, lod: 280,
  },
};

const resolved = new Map<string, QualitySettings>();
function resolve(level: QualityLevel, veg: VegLevel | "auto"): QualitySettings {
  const key = `${level}|${veg}`;
  let r = resolved.get(key);
  if (!r) {
    const vl = veg === "auto" ? PRESET_VEG[level] : veg;
    r = { ...BASE[level], vegLevel: vl, veg: VEGETATION[vl] };
    resolved.set(key, r);
  }
  return r;
}
/** Settings for a preset (vegetation at the preset's own default). */
export const QUALITY: Record<QualityLevel, QualitySettings> = {
  performance: resolve("performance", "auto"), balanced: resolve("balanced", "auto"),
  high: resolve("high", "auto"), ultra: resolve("ultra", "auto"),
};

const KEY = "pitstop.quality";
const listeners = new Set<() => void>();
let current: QualityLevel = (() => {
  try {
    const v = localStorage.getItem(KEY) as QualityLevel | null;
    if (v && v in BASE) return v;
    const q = new URLSearchParams(window.location.search).get("quality");
    if (q === "low") return "performance";
    if (q && q in BASE) return q as QualityLevel;
  } catch {
    // storage unavailable: fall back to the default
  }
  return "balanced";
})();

const VKEY = "pitstop.vegetation";
let vegChoice: VegLevel | "auto" = (() => {
  try {
    const v = new URLSearchParams(window.location.search).get("veg") ?? localStorage.getItem(VKEY);
    if (v && (v in VEGETATION)) return v as VegLevel;
  } catch {
    // storage unavailable: automatic
  }
  return "auto";
})();
export function setVegetation(v: VegLevel | "auto"): void {
  vegChoice = v;
  try { localStorage.setItem(VKEY, v); } catch { /* ignore */ }
  listeners.forEach((l) => l());
}

export function setQuality(level: QualityLevel): void {
  current = level;
  try { localStorage.setItem(KEY, level); } catch { /* ignore */ }
  listeners.forEach((l) => l());
}

export function getQualityLevel(): QualityLevel {
  return current;
}

export function useQuality(): { level: QualityLevel; vegChoice: VegLevel | "auto"; q: QualitySettings } {
  const key = useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => `${current}|${vegChoice}`,
  );
  const [level, veg] = key.split("|") as [QualityLevel, VegLevel | "auto"];
  return { level, vegChoice: veg, q: resolve(level, veg) };
}
