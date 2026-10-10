import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { CarSummary, RaceState } from "../types/race";
import { getCircuit } from "../lib/circuit";
import { RaceClock } from "../lib/raceClock";
import { COMPOUND_COLOR } from "../lib/compounds";
import { fmtLap, pct } from "../lib/format";
import Scene3D from "./scene/Scene3D";
import LoadingOverlay from "./scene/LoadingOverlay";
import StartLightsHud from "./scene/StartLightsHud";
import { newLive, type CamMode } from "./scene/live";
import { Chip } from "./ui/Panel";
import { setQuality, setVegetation, useQuality, VEG_LEVELS, type QualityLevel, type VegLevel } from "../lib/quality";

class Boundary extends Component<{ children: ReactNode }, { err: string | null }> {
  state = { err: null as string | null };
  static getDerivedStateFromError(e: Error) { return { err: e.message }; }
  render() {
    if (this.state.err) {
      return (
        <div className="absolute inset-0 grid place-items-center text-center p-8">
          <div>
            <div className="num text-3xl text-red uppercase">3D view unavailable</div>
            <div className="text-muted text-[12px] mt-2">WebGL could not start: {this.state.err}</div>
            <div className="text-muted text-[12px]">Telemetry and strategy remain available in the race console.</div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

interface Standing { id: string; code: string; color: string; primary: boolean; gap: string; compound: CarSummary["compound"]; stops: number; lapNo: number }

function useStandings(state: RaceState, live: ReturnType<typeof newLive> extends infer T ? React.MutableRefObject<T> : never) {
  const [rows, setRows] = useState<Standing[]>([]);
  const sref = useRef(state);
  sref.current = state;
  useEffect(() => {
    let last = "";
    const id = window.setInterval(() => {
      const s = sref.current;
      const N = s.total_laps;
      // cars that have taken the flag are ordered by authoritative finishing time
      const tot = s.cars.map((c) => {
        const raw = live.current.poses.get(c.id)?.place.total ?? -c.grid_slot * 1e-3;
        const fin = raw >= N && c.laps.length >= N;
        return { c, t: fin ? N + 1 - c.elapsed_s * 1e-6 : raw, fin };
      });
      tot.sort((a, b) => b.t - a.t || a.c.grid_slot - b.c.grid_slot);
      const lead = tot[0]?.t ?? 0;
      const out: Standing[] = tot.map(({ c, t, fin }, i) => {
        const dLaps = lead - t;
        const gap = i === 0 ? (fin ? "WINNER" : "LEADER")
          : fin && tot[0].fin ? `+${c.gap_to_leader_s.toFixed(1)}`
          : dLaps >= 1 ? `+${Math.floor(dLaps)} LAP` : `+${(dLaps * (c.last_lap_s ?? 92)).toFixed(1)}`;
        const lapNo = Math.min(s.total_laps, Math.max(1, Math.floor(Math.max(0, t)) + 1));
        return { id: c.id, code: c.code, color: c.color, primary: c.is_primary, gap, compound: c.compound, stops: c.pit_stops, lapNo };
      });
      const sig = out.map((r) => `${r.id}${r.gap}${r.compound}${r.stops}`).join("|");
      if (sig !== last) { last = sig; setRows(out); }
    }, 120);
    return () => window.clearInterval(id);
  }, [live]);
  return rows;
}

interface Props { state: RaceState; clock: RaceClock; drawerOpen: boolean }

export default function RaceView({ state, clock, drawerOpen }: Props) {
  const circuit = useMemo(() => getCircuit(state.circuit_id), [state.circuit_id]);
  const live = useRef(newLive());
  const [mode, setMode] = useState<CamMode>(() => (new URLSearchParams(window.location.search).get("cam") as CamMode) || "cinematic");
  const [resetKey, setResetKey] = useState(0);
  const quality = useQuality();
  const primary = state.cars.find((c) => c.is_primary)!;
  const [selected, setSelected] = useState(primary.id);
  const rows = useStandings(state, live);
  const sel = state.cars.find((c) => c.id === selected) ?? primary;
  const rec = state.recommendation;

  // transient toast for race-changing events (rain, safety car, pit stops)
  const lastEvent = useRef(state.events.length ? state.events[state.events.length - 1].id : 0);
  const [toast, setToast] = useState<{ id: number; msg: string; color: string } | null>(null);
  useEffect(() => {
    const newest = state.events.length ? state.events[state.events.length - 1].id : 0;
    if (newest < lastEvent.current) lastEvent.current = 0;   // race was reset
    const fresh = state.events.filter((e) => e.id > lastEvent.current);
    if (!fresh.length) return;
    lastEvent.current = newest;
    const hit = [...fresh].reverse().find((e) => /^(RAIN_|SC_|PIT_STOP|FORCED_PIT)/.test(e.type));
    if (!hit) return;
    const color = hit.type.startsWith("RAIN") ? "#2f8bff" : hit.type.startsWith("SC") ? "#ffb020" : "#ff3b47";
    setToast({ id: hit.id, msg: hit.message, color });
    const t = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(t);
  }, [state.events]);

  // recommended pit window: first-stop laps of plans within 1.5 s of the best expected finish
  const window_ = useMemo(() => {
    if (!rec || !rec.top_candidates.length) return null;
    const best = rec.top_candidates[0].expected_s;
    const laps = rec.top_candidates.filter((c) => c.plan.length && c.expected_s - best <= 1.5).map((c) => c.plan[0].lap);
    if (!laps.length) return null;
    return { from: Math.min(...laps), to: Math.max(...laps) };
  }, [rec]);
  const boxLabel = rec?.compound ? `${rec.compound}` : "";
  const executed = state.laps.filter((l) => l.pitted).map((l) => l.lap);
  const proposed = rec ? rec.plan.map((p) => p.lap) : [];
  const done = state.status === "finished";
  const faded = drawerOpen ? "opacity-0 pointer-events-none" : "opacity-100";

  return (
    <section className="relative flex-1 min-h-[480px] overflow-hidden" aria-label="Live 3D race">
      <div className="absolute inset-0">
        <Boundary>
          <Scene3D circuit={circuit} state={state} clock={clock} live={live} mode={mode} resetKey={resetKey}
            selectedId={selected} followId={selected} onSelect={setSelected} boxLabel={boxLabel} drawerOpen={drawerOpen} />
        </Boundary>
      </div>
      {/* edge vignette blends the 3D world into the maroon environment */}
      <div className="absolute inset-0 pointer-events-none"
        style={{ background: "radial-gradient(ellipse at 50% 45%, rgba(42,10,16,0) 50%, rgba(42,10,16,.78) 100%), linear-gradient(180deg, rgba(28,7,11,.35), transparent 14%)" }} />

      <LoadingOverlay />
      <StartLightsHud live={live} />

      {/* camera controls */}
      <div className="absolute top-3 left-3 flex flex-wrap gap-1 z-10">
        {(["cinematic", "top", "follow", "chase", "corner"] as CamMode[]).map((m) => (
          <button key={m} className={`btn !px-3 !py-[3px] !text-[13px] ${mode === m ? "btn-primary" : ""}`} onClick={() => setMode(m)}>
            {m === "cinematic" ? "3D view" : m === "top" ? "Top-down" : m === "follow" ? "Follow car" : m === "chase" ? "Low chase" : "Corner"}
          </button>
        ))}
        <button className="btn !px-3 !py-[3px] !text-[13px]" onClick={() => { setMode("cinematic"); setResetKey((k) => k + 1); }}>Overview</button>
        <div className="!fixed bottom-[58px] right-3 z-10 flex items-center gap-3">
          <label className="flex items-center gap-1" title="Graphics preset: shadows, MSAA, reflections, effects">
            <span className="label !text-[9px]">Graphics</span>
            <select aria-label="Graphics quality" className="btn !px-2 !py-[3px] !text-[13px]" value={quality.level}
              onChange={(e) => setQuality(e.target.value as QualityLevel)}>
              {(["performance", "balanced", "high", "ultra"] as QualityLevel[]).map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1" title="Trees and bushes around the circuit. Auto follows the graphics preset.">
            <span className="label !text-[9px]">Vegetation</span>
            <select aria-label="Vegetation density" className="btn !px-2 !py-[3px] !text-[13px]" value={quality.vegChoice}
              onChange={(e) => setVegetation(e.target.value as VegLevel | "auto")}>
              <option value="auto">auto ({quality.q.vegLevel})</option>
              {VEG_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </label>
        </div>
      </div>

      {/* timing tower */}
      <div className="absolute top-14 left-3 z-10 w-[188px]"
        style={{ background: "rgba(36,9,15,.78)", border: "1px solid rgba(255,120,130,.3)", backdropFilter: "blur(6px)" }}>
        <div className="px-2 py-1 label flex justify-between"><span>Live order</span><span>Lap {Math.min(state.total_laps, Math.max(1, rows.find((r) => r.primary)?.lapNo ?? 1))}/{state.total_laps}</span></div>
        <div className="relative" style={{ height: rows.length * 27 }}>
          {rows.map((r, i) => (
            <button key={r.id} onClick={() => setSelected(r.id)}
              className="absolute left-0 right-0 h-[26px] flex items-center gap-2 px-2 text-left"
              style={{ top: i * 27, transition: "top 450ms cubic-bezier(.2,.8,.2,1)",
                background: r.id === selected ? "rgba(255,255,255,.12)" : r.primary ? "rgba(255,59,71,.2)" : "transparent",
                borderLeft: `3px solid ${r.color}` }}>
              <span className="num w-4 text-[15px]">{i + 1}</span>
              <span className={`num text-[15px] w-9 ${r.primary ? "text-red" : ""}`}>{r.code}</span>
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: COMPOUND_COLOR[r.compound] }} />
              <span className="text-[10px] text-muted ml-auto">{r.gap}</span>
            </button>
          ))}
        </div>
        <div className="px-2 py-1 text-[9px] text-muted">Rivals are simulated AI (rule-based), not real drivers or data.</div>
      </div>

      {/* lap strip: proposed vs executed stops */}
      <div className="absolute top-3 left-1/2 z-10 hidden lg:flex items-center gap-[2px] w-[min(520px,32vw)]"
        style={{ background: "rgba(36,9,15,.7)", padding: "6px 8px", border: "1px solid rgba(255,120,130,.3)", backdropFilter: "blur(6px)", transform: "translateX(-40%)" }}>
        {Array.from({ length: state.total_laps }, (_, i) => {
          const lap = i + 1;
          const inWin = window_ && lap >= window_.from && lap <= window_.to && lap > state.lap && !done;
          const ex = executed.includes(lap);
          const pr = proposed.includes(lap) && lap > state.lap;
          return (
            <div key={lap} className="flex-1 h-[18px] relative" title={`Lap ${lap}`}
              style={{ background: lap <= state.lap ? "#8a3a49" : "#3a141c",
                outline: inWin ? "1px solid #ffb020" : "none", boxShadow: lap === state.lap + 1 && !done ? "inset 0 -3px 0 #fff" : "none" }}>
              {ex && <span className="absolute inset-0 grid place-items-center text-[9px] font-semibold" style={{ background: "#2fe08a", color: "#000" }} title="Executed stop">P</span>}
              {pr && !ex && <span className="absolute inset-0 grid place-items-center text-[9px] border border-dashed border-red text-red" title="Proposed stop">P?</span>}
            </div>
          );
        })}
      </div>

      {/* conditions + optimizer recommendation */}
      <div className="absolute top-3 right-3 z-10 flex flex-col items-end gap-2 max-w-[300px] max-md:max-w-[180px]">
        <div className="flex gap-2">
          <Chip color={state.conditions.weather === "DRY" ? "#cfb0b4" : "#2f8bff"}>{state.conditions.weather} {state.conditions.track_wetness.toFixed(2)}</Chip>
          {state.conditions.safety_car && <Chip color="#ffb020">Safety car</Chip>}
        </div>
        {rec && !done && (
          <div className="p-3 text-right w-full"
            style={{ background: "rgba(36,9,15,.8)", backdropFilter: "blur(6px)", border: `1px solid ${rec.action === "BOX_THIS_LAP" ? "#ff3b47" : "#2fe08a"}` }}>
            <div className="label">Optimizer recommendation</div>
            <div className="num text-3xl uppercase leading-none" style={{ color: rec.action === "BOX_THIS_LAP" ? "#ff3b47" : "#2fe08a" }}>
              {rec.action === "BOX_THIS_LAP" ? "Box this lap" : "Stay out"}
            </div>
            <div className="text-[11px] mt-1">
              {rec.compound && <span style={{ color: COMPOUND_COLOR[rec.compound] }}>{rec.compound} </span>}
              {window_ ? `window L${window_.from}${window_.to > window_.from ? `-L${window_.to}` : ""}` : "no stop planned"}
            </div>
            <div className="text-[10px] text-muted">advantage vs next best: {rec.time_advantage_s.toFixed(1)}s</div>
            <div className="text-[10px] text-muted mt-1 leading-snug">Proposal only. It is executed when the simulation boxes the car.</div>
          </div>
        )}
      </div>

      {toast && (
        <div key={toast.id} className="toast-in absolute top-16 left-1/2 z-20 px-5 py-2 num text-[18px] uppercase tracking-wide whitespace-nowrap"
          style={{ background: "rgba(36,9,15,.92)", border: `1px solid ${toast.color}`, color: "#fff", boxShadow: `0 0 24px ${toast.color}66`, marginLeft: 40 }}>
          <span className="inline-block w-2 h-2 rounded-full mr-3 pulse-dot" style={{ background: toast.color }} />{toast.msg}
        </div>
      )}

      {/* selected car telemetry */}
      <div className={`absolute bottom-4 left-3 z-10 w-[270px] p-3 transition-opacity duration-300 max-md:hidden ${faded}`}
        style={{ background: "rgba(36,9,15,.8)", backdropFilter: "blur(6px)", border: `1px solid ${sel.color}88` }}>
        <div className="flex items-center gap-2">
          <span className="w-2 h-6" style={{ background: sel.color }} />
          <div>
            <div className="num text-xl leading-none uppercase">{sel.code} <span className="text-muted text-sm">{sel.name}</span></div>
            <div className="text-[10px] text-muted">{sel.is_primary ? "STRATEGY-CONTROLLED (optimizer)" : "Simulated competitor (rule-based AI)"}</div>
          </div>
          <span className="num text-3xl ml-auto">P{sel.position}</span>
        </div>
        <div className="grid grid-cols-3 gap-2 mt-2 text-[11px]">
          <div><div className="label">Tyre</div><span style={{ color: COMPOUND_COLOR[sel.compound] }}>{sel.compound}</span> {pct(sel.tyre_wear)}</div>
          <div><div className="label">Age</div>{sel.tyre_age} laps</div>
          <div><div className="label">Fuel</div>{sel.fuel_kg.toFixed(1)} kg</div>
          <div><div className="label">Last lap</div>{fmtLap(sel.last_lap_s)}</div>
          <div><div className="label">Stops</div>{sel.pit_stops}</div>
          <div><div className="label">Gap (lap {state.lap})</div>{sel.position === 1 ? "leader" : `+${sel.gap_to_leader_s.toFixed(1)}s`}</div>
        </div>
      </div>

      <div className={`absolute bottom-3 right-3 z-10 max-w-[320px] text-right text-[9px] text-muted leading-snug transition-opacity duration-300 max-md:hidden ${faded}`}>
        {circuit.data.name}. Geometry: {circuit.data.source.dataset} ({circuit.data.source.license.split(";")[0]}); start line, pit lane and sectors approximate.
        Cars enlarged. Positions interpolated from authoritative lap times.
      </div>
    </section>
  );
}
