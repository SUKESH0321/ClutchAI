import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { CarSummary, RaceState } from "../types/race";
import { getCircuit } from "../lib/circuit";
import { RaceClock } from "../lib/raceClock";
import { COMPOUND_COLOR } from "../lib/compounds";
import { fmtLap, pct } from "../lib/format";
import Scene3D from "./scene/Scene3D";
import { newLive, type CamMode } from "./scene/live";
import { Chip } from "./ui/Panel";

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
            <div className="text-muted text-[12px]">All telemetry and strategy panels below keep working.</div>
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

export default function RaceView({ state, clock }: { state: RaceState; clock: RaceClock }) {
  const circuit = useMemo(() => getCircuit(state.circuit_id), [state.circuit_id]);
  const live = useRef(newLive());
  const [mode, setMode] = useState<CamMode>("cinematic");
  const [resetKey, setResetKey] = useState(0);
  const primary = state.cars.find((c) => c.is_primary)!;
  const [selected, setSelected] = useState(primary.id);
  const rows = useStandings(state, live);
  const sel = state.cars.find((c) => c.id === selected) ?? primary;
  const rec = state.recommendation;

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

  return (
    <section className="panel fade-in h-full">
      <div className="panel-in flex flex-col">
        <header className="panel-head">
          <span className="tick" />
          <span className="label text-ink">01 / {circuit.data.name} / live 3D race</span>
          <span className="ml-auto flex gap-2">
            <Chip color={state.conditions.weather === "DRY" ? "#8A93A3" : "#2F8BFF"}>{state.conditions.weather} {state.conditions.track_wetness.toFixed(2)}</Chip>
            {state.conditions.safety_car && <Chip color="#FFB020">Safety car</Chip>}
          </span>
        </header>

        <div className="relative h-[640px] bg-bg overflow-hidden">
          <Boundary>
            <Scene3D circuit={circuit} state={state} clock={clock} live={live} mode={mode} resetKey={resetKey}
              selectedId={selected} followId={selected} onSelect={setSelected} boxLabel={boxLabel} />
          </Boundary>

          {/* camera controls */}
          <div className="absolute top-3 left-3 flex gap-1 z-10">
            {(["cinematic", "top", "follow"] as CamMode[]).map((m) => (
              <button key={m} className={`btn !px-3 !py-[3px] !text-[13px] ${mode === m ? "btn-primary" : ""}`} onClick={() => setMode(m)}>
                {m === "cinematic" ? "3D view" : m === "top" ? "Top-down" : "Follow car"}
              </button>
            ))}
            <button className="btn !px-3 !py-[3px] !text-[13px]" onClick={() => { setMode("cinematic"); setResetKey((k) => k + 1); }}>Reset camera</button>
          </div>

          {/* timing tower */}
          <div className="absolute top-14 left-3 z-10 w-[188px] pointer-events-auto" style={{ background: "rgba(7,8,10,.72)", border: "1px solid #1f242d" }}>
            <div className="px-2 py-1 label flex justify-between"><span>Live order</span><span>Lap {Math.min(state.total_laps, Math.max(1, rows.find((r) => r.primary)?.lapNo ?? 1))}/{state.total_laps}</span></div>
            <div className="relative" style={{ height: rows.length * 27 }}>
              {rows.map((r, i) => (
                <button key={r.id} onClick={() => setSelected(r.id)}
                  className="absolute left-0 right-0 h-[26px] flex items-center gap-2 px-2 text-left"
                  style={{ top: i * 27, transition: "top 450ms cubic-bezier(.2,.8,.2,1)",
                    background: r.id === selected ? "rgba(255,255,255,.10)" : r.primary ? "rgba(255,45,58,.16)" : "transparent",
                    borderLeft: `3px solid ${r.color}` }}>
                  <span className="num w-4 text-[15px]">{i + 1}</span>
                  <span className={`num text-[15px] w-9 ${r.primary ? "text-red" : ""}`}>{r.code}</span>
                  <span className="inline-block w-2 h-2 rounded-full" style={{ background: COMPOUND_COLOR[r.compound] }} />
                  <span className="text-[10px] text-muted ml-auto">{r.gap}</span>
                </button>
              ))}
            </div>
            <div className="px-2 py-1 text-[9px] text-muted">Rival cars are simulated AI (rule-based) - not real drivers or data.</div>
          </div>

          {/* selected car telemetry */}
          <div className="absolute bottom-16 left-3 z-10 w-[270px] p-3" style={{ background: "rgba(7,8,10,.78)", border: `1px solid ${sel.color}88` }}>
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

          {/* recommendation overlay */}
          {rec && !done && (
            <div className="absolute top-3 right-3 z-10 max-w-[300px] p-3 text-right"
              style={{ background: "rgba(7,8,10,.78)", border: `1px solid ${rec.action === "BOX_THIS_LAP" ? "#FF2D3A" : "#22D37A"}` }}>
              <div className="label">Optimizer recommendation</div>
              <div className="num text-3xl uppercase leading-none" style={{ color: rec.action === "BOX_THIS_LAP" ? "#FF2D3A" : "#22D37A" }}>
                {rec.action === "BOX_THIS_LAP" ? "Box this lap" : "Stay out"}
              </div>
              <div className="text-[11px] mt-1">
                {rec.compound && <span style={{ color: COMPOUND_COLOR[rec.compound] }}>{rec.compound} </span>}
                {window_ ? `window L${window_.from}${window_.to > window_.from ? `-L${window_.to}` : ""}` : "no stop planned"}
              </div>
              <div className="text-[10px] text-muted">advantage vs next best: {rec.time_advantage_s.toFixed(1)}s</div>
              <div className="text-[10px] text-muted mt-1 leading-snug">Proposal only - executed when the simulation boxes the car.</div>
            </div>
          )}

          {/* lap strip: proposed vs executed stops */}
          <div className="absolute bottom-3 left-3 right-3 z-10 flex items-center gap-[2px]" style={{ background: "rgba(7,8,10,.6)", padding: "6px 8px", border: "1px solid #1f242d" }}>
            <span className="label mr-2 shrink-0">Laps</span>
            {Array.from({ length: state.total_laps }, (_, i) => {
              const lap = i + 1;
              const inWin = window_ && lap >= window_.from && lap <= window_.to && lap > state.lap && !done;
              const ex = executed.includes(lap);
              const pr = proposed.includes(lap) && lap > state.lap;
              return (
                <div key={lap} className="flex-1 h-[18px] relative" title={`Lap ${lap}`}
                  style={{ background: lap <= state.lap ? "#2a303b" : "#12151b",
                    outline: inWin ? "1px solid #ffb020" : "none", boxShadow: lap === state.lap + 1 && !done ? "inset 0 -3px 0 #fff" : "none" }}>
                  {ex && <span className="absolute inset-0 grid place-items-center text-[9px] font-semibold" style={{ background: "#22D37A", color: "#000" }} title="Executed stop">P</span>}
                  {pr && !ex && <span className="absolute inset-0 grid place-items-center text-[9px] border border-dashed border-red text-red" title="Proposed stop">P?</span>}
                </div>
              );
            })}
            <span className="label ml-2 shrink-0 hidden md:block"><b className="text-green">P</b> executed <b className="text-red">P?</b> proposed <b className="text-amber">box</b> window</span>
          </div>
        </div>

        <div className="px-4 py-2 text-[10px] text-muted border-t border-line">
          Circuit: {circuit.data.name} - geometry from {circuit.data.source.dataset} ({circuit.data.source.license.split(";")[0]}); start line, pit lane and sectors approximate.
          Cars enlarged for visibility. Positions are interpolated from authoritative lap times.
        </div>
      </div>
    </section>
  );
}
