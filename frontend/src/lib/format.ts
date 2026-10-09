export const pad = (n: number, w = 2) => String(Math.floor(n)).padStart(w, "0");

export function fmtClock(s: number): string {
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${pad(m)}:${r.toFixed(1).padStart(4, "0")}`;
}

export function fmtLap(s: number | null | undefined): string {
  if (s == null) return "-:--.---";
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r.toFixed(3).padStart(6, "0")}`;
}

export const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;
export const signed = (x: number, d = 1) => `${x >= 0 ? "+" : "-"}${Math.abs(x).toFixed(d)}`;
