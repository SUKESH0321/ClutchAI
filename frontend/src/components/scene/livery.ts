import * as THREE from "three";

/** Fictional team liveries. Cars are fictional; no real team or driver is represented. */
export interface Livery { primary: string; secondary: string; number: number; model: "f1" | "race" | "race-future" }

const SECONDARY = ["#1d1f26", "#f1f1ee", "#2a2f3a", "#e8e3da", "#16181d", "#d9dde3", "#222630", "#f4efe6"];
const NUMBERS = [7, 12, 23, 33, 48, 55, 71, 88];

export function liveryFor(index: number, primaryColor: string, isPrimary: boolean): Livery {
  if (isPrimary) return { primary: primaryColor, secondary: "#14161b", number: 1, model: "f1" };
  return {
    primary: primaryColor,
    secondary: SECONDARY[index % SECONDARY.length],
    number: NUMBERS[index % NUMBERS.length],
    model: "f1",
  };
}

/**
 * The Kenney car models share one 512x512 palette (8 columns x 4 rows of gradient swatches). On the race cars the
 * body paint is the swatch at row 1, column 6 and the secondary colour is row 2, column 3, so a per-team palette
 * (a recoloured copy of that image) turns one model into many liveries.
 */
const PAINT = { col: 6, row: 1 };
const SECOND = { col: 3, row: 2 };

function paintCell(g: CanvasRenderingContext2D, col: number, row: number, hex: string, W: number, H: number) {
  const cw = W / 8, ch = H / 4;
  const base = new THREE.Color(hex);
  const light = base.clone().lerp(new THREE.Color("#ffffff"), 0.22).getStyle();
  const dark = base.clone().multiplyScalar(0.62).getStyle();
  const left = g.createLinearGradient(0, row * ch, 0, (row + 1) * ch);
  left.addColorStop(0, light); left.addColorStop(1, base.getStyle());
  g.fillStyle = left; g.fillRect(col * cw, row * ch, cw / 2, ch);
  const right = g.createLinearGradient(0, row * ch, 0, (row + 1) * ch);
  right.addColorStop(0, base.getStyle()); right.addColorStop(1, dark);
  g.fillStyle = right; g.fillRect(col * cw + cw / 2, row * ch, cw / 2, ch);
}

const cache = new Map<string, THREE.CanvasTexture>();
export function liveryPalette(source: THREE.Texture, l: Livery): THREE.CanvasTexture {
  const key = `${l.primary}|${l.secondary}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const img = source.image as CanvasImageSource & { width: number; height: number };
  const W = img.width, H = img.height;
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const g = cv.getContext("2d")!;
  g.drawImage(img, 0, 0);
  paintCell(g, PAINT.col, PAINT.row, l.primary, W, H);
  paintCell(g, SECOND.col, SECOND.row, l.secondary, W, H);
  const t = new THREE.CanvasTexture(cv);
  t.flipY = false;                      // glTF convention
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  cache.set(key, t);
  return t;
}

/** A race-number decal (white disc, black digits) used on the nose, engine cover and sidepods. */
const numCache = new Map<number, THREE.CanvasTexture>();
export function numberTexture(n: number): THREE.CanvasTexture {
  const hit = numCache.get(n); if (hit) return hit;
  const cv = document.createElement("canvas"); cv.width = 128; cv.height = 128;
  const g = cv.getContext("2d")!;
  g.clearRect(0, 0, 128, 128);
  g.fillStyle = "rgba(255,255,255,0.96)"; g.beginPath(); g.arc(64, 64, 58, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#111"; g.font = "italic 800 78px 'Barlow Condensed', Impact, sans-serif";
  g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(String(n), 64, 70);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  numCache.set(n, t); return t;
}
