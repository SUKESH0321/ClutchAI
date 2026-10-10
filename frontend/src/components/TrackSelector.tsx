import { useEffect, useMemo, useState } from "react";
import { api } from "../services/api";
import { CIRCUITS, listCircuits, type CircuitData } from "../lib/circuit";
import type { RaceState, TrackInfo } from "../types/race";
import { fmtClock } from "../lib/format";

interface Props {
  open: boolean;
  state: RaceState;
  busy: boolean;
  onClose: () => void;
  /** switch the simulation to this circuit (the caller resets the race on the backend) */
  onSelect: (id: string) => void;
}

/** Layout preview drawn from the circuit's own centreline: the same points the 3D scene and the simulation use. */
export function TrackPreview({ data, w = 190, h = 128, active = false }: { data: CircuitData; w?: number; h?: number; active?: boolean }) {
  const { d, start, dir, pit } = useMemo(() => {
    const xs = data.points.map((p) => p[0]), ys = data.points.map((p) => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const pad = 10, s = Math.min((w - 2 * pad) / (maxX - minX), (h - 2 * pad) / (maxY - minY));
    const ox = (w - s * (maxX - minX)) / 2, oy = (h - s * (maxY - minY)) / 2;
    const P = (p: number[]) => [ox + (p[0] - minX) * s, h - (oy + (p[1] - minY) * s)] as const;   // map north is up
    const pts = data.points.map(P);
    const path = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join("") + "Z";
    const pl = data.pit_lane.points.map(P);
    const pitPath = pl.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join("");
    const a = pts[0], b = pts[14];
    return { d: path, start: a, dir: Math.atan2(b[1] - a[1], b[0] - a[0]), pit: pitPath };
  }, [data, w, h]);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" role="img" aria-label={`${data.name} layout`} style={{ maxHeight: h * 1.3 }}>
      <path d={d} fill="none" stroke="rgba(0,0,0,.55)" strokeWidth="6.5" strokeLinejoin="round" />
      <path d={d} fill="none" stroke={active ? "#ff3b47" : "#d9b9bd"} strokeWidth="3.4" strokeLinejoin="round" />
      <path d={pit} fill="none" stroke="#ffb020" strokeWidth="1.4" opacity=".8" />
      <g transform={`translate(${start[0]} ${start[1]}) rotate(${(dir * 180) / Math.PI})`}>
        <rect x="-1.5" y="-6" width="3" height="12" fill="#fff" />
        <path d="M 7 0 L 1 -3.6 L 1 3.6 Z" fill="#fff" />
      </g>
    </svg>
  );
}

function Row({ k, v, note }: { k: string; v: string; note?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-[12px] leading-[1.5]">
      <span className="label !text-[9px]">{k}</span>
      <span className="num text-[15px] text-right">{v}{note && <span className="text-[10px] text-muted ml-1 normal-case tracking-normal">{note}</span>}</span>
    </div>
  );
}

export default function TrackSelector({ open, state, busy, onClose, onSelect }: Props) {
  const [info, setInfo] = useState<Record<string, TrackInfo>>({});
  const [pending, setPending] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if (!open) { setPending(null); return; }
    api.circuits().then((l) => { setInfo(Object.fromEntries(l.map((t) => [t.id, t]))); setOffline(false); }).catch(() => setOffline(true));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, onClose]);

  if (!open) return null;
  const inProgress = state.lap > 0 && state.status !== "finished";
  const choose = (id: string) => {
    if (id === state.circuit_id) { onClose(); return; }
    if (inProgress) setPending(id);
    else { onSelect(id); onClose(); }
  };
  const confirm = () => { if (pending) { onSelect(pending); setPending(null); onClose(); } };

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center p-4" role="dialog" aria-modal="true" aria-label="Track selection"
      style={{ background: "rgba(14,3,6,.78)", backdropFilter: "blur(5px)" }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-[1100px] max-h-[92vh] overflow-auto"
        style={{ background: "linear-gradient(180deg, rgba(58,14,24,.97), rgba(28,7,13,.97))", border: "1px solid rgba(255,110,120,.4)", boxShadow: "0 24px 80px rgba(0,0,0,.7)" }}>
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[rgba(255,120,130,.28)]">
          <span className="tick" />
          <div>
            <div className="label !text-[10px] text-ink">Track selection</div>
            <div className="text-[11px] text-muted">Pick a circuit: the 3D venue, the cars, the pit lane and the strategy simulation all switch to it.</div>
          </div>
          <button className="btn ml-auto !px-3 !py-[3px] !text-[13px]" onClick={onClose}>Close</button>
        </div>

        {pending && (
          <div role="alertdialog" className="mx-4 mt-3 px-3 py-2 flex flex-wrap items-center gap-3 text-[12px]"
            style={{ background: "rgba(120,10,25,.55)", border: "1px solid #ff3b47" }}>
            <span className="flex-1 min-w-[260px]">
              A race is in progress (lap {state.lap}/{state.total_laps}, {state.status}). Switching to <b>{CIRCUITS[pending]?.name}</b> resets the race:
              lap history, timing, car positions and strategy recommendations are cleared and re-initialised for the new circuit.
            </span>
            <button className="btn btn-primary !px-3 !py-[3px] !text-[13px]" disabled={busy} onClick={confirm}>Switch and reset</button>
            <button className="btn !px-3 !py-[3px] !text-[13px]" onClick={() => setPending(null)}>Keep racing</button>
          </div>
        )}
        {offline && <div className="mx-4 mt-3 text-[11px] text-amber">Backend circuit catalogue unavailable: simulation figures below are hidden.</div>}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-4">
          {listCircuits().map((c) => {
            const t = info[c.id];
            const selected = c.id === state.circuit_id;
            return (
              <button key={c.id} type="button" onClick={() => choose(c.id)} disabled={busy} aria-pressed={selected}
                className="text-left p-3 transition-colors"
                style={{
                  background: selected ? "linear-gradient(180deg, rgba(255,59,71,.2), rgba(255,59,71,.07))" : "rgba(255,255,255,.035)",
                  border: `1px solid ${selected ? "#ff3b47" : "rgba(255,120,130,.25)"}`,
                  boxShadow: selected ? "0 0 22px rgba(255,59,71,.35)" : "none",
                }}>
                <div className="flex items-start gap-3">
                  <div className="w-[44%] shrink-0 grid place-items-center" style={{ background: "rgba(0,0,0,.32)", border: "1px solid rgba(255,120,130,.15)" }}>
                    <TrackPreview data={c} active={selected} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="num text-[20px] uppercase leading-none">{c.name}</span>
                      {selected && <span className="num text-[11px] px-2" style={{ background: "#ff3b47", color: "#fff", letterSpacing: ".12em" }}>SELECTED</span>}
                    </div>
                    <div className="label !text-[10px] mt-1">{c.location}, {c.country}</div>
                    <div className="mt-2 space-y-[1px]">
                      <Row k="Length" v={`${(c.length_m / 1000).toFixed(3)} km`} note={`measured · published ${(c.official_reference.length_m / 1000).toFixed(3)}`} />
                      <Row k="Turns" v={`${c.official_reference.turns}`} note={`published · ${c.corners.length} detected`} />
                      <Row k="Direction" v={c.clockwise ? "Clockwise" : "Anticlockwise"} />
                      {t && <Row k="Base lap (est.)" v={fmtClock(t.base_lap_s)} note="model estimate" />}
                      {t && <Row k="Fuel / lap" v={`${t.fuel_burn_kg_per_lap.toFixed(2)} kg`} />}
                      {t && <Row k="Tyre wear" v={`×${t.sim.wear_factor.toFixed(2)}`} note="vs Silverstone" />}
                    </div>
                  </div>
                </div>
                <p className="text-[12px] text-muted mt-2">{c.description}</p>
                <div className="text-[10px] text-muted mt-2 leading-snug">
                  Geometry: {c.source.dataset} (OSM-derived, {c.source.license.split(";")[0]}). Pit lane, sector splits and start line are approximations; elevation is not in the source data.
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
