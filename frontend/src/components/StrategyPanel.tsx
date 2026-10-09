import { useEffect, useRef, useState } from "react";
import type { PlanStop, RaceState } from "../types/race";
import { COMPOUND_COLOR } from "../lib/compounds";
import { fmtClock, pct } from "../lib/format";
import { Chip, Panel, Stat } from "./ui/Panel";

function PlanChips({ plan, empty }: { plan: PlanStop[] | null; empty: string }) {
  if (plan == null) return <span className="text-muted text-[11px]">n/a</span>;
  if (plan.length === 0) return <span className="text-muted text-[11px]">{empty}</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {plan.map((s, i) => (
        <span key={i} className="px-2 py-[1px] border text-[11px]"
          style={{ borderColor: COMPOUND_COLOR[s.compound], color: COMPOUND_COLOR[s.compound] }}>
          L{s.lap} {s.compound}
        </span>
      ))}
    </span>
  );
}

export default function StrategyPanel({ state }: { state: RaceState }) {
  const r = state.recommendation;
  // highlight whenever the optimizer actually changes its recommendation
  const sig = r ? `${r.action}|${r.plan.map((p) => `${p.lap}${p.compound}`).join(",")}` : "";
  const prev = useRef(sig);
  const [flashKey, setFlashKey] = useState(0);
  useEffect(() => {
    if (prev.current !== sig) { prev.current = sig; setFlashKey((k) => k + 1); }
  }, [sig]);

  if (!r) {
    return <Panel idx="03" title="Strategy engine"><div className="text-muted">Waiting for the first recommendation...</div></Panel>;
  }
  const finished = state.status === "finished";
  const box = r.action === "BOX_THIS_LAP";
  const planned = !box && r.pit_lap != null;
  const theme = finished ? { c: "#cfb0b4", bg: "rgba(207,176,180,.08)" }
    : box ? { c: "#ff3b47", bg: "rgba(255,59,71,.16)" }
    : planned ? { c: "#ffb020", bg: "rgba(255,176,32,.12)" }
    : { c: "#2fe08a", bg: "rgba(47,224,138,.10)" };
  const headline = finished ? "Race over" : box ? "Box this lap" : planned ? `Pit lap ${r.pit_lap}` : "Stay out";
  const subline = finished ? "No further decisions"
    : box ? `Pit now for ${r.compound}`
    : planned ? `Stay out until lap ${r.pit_lap}, then fit ${r.compound}`
    : "No further stop planned";
  const lo = Math.min(...r.top_candidates.map((c) => c.p10_s));
  const hi = Math.max(...r.top_candidates.map((c) => c.p90_s));
  const span = Math.max(1, hi - lo);
  const alt = r.best_alternative;

  return (
    <Panel
      idx="03" title="Strategy engine"
      right={<><Chip color="#4fe0f7">trigger: {r.trigger.replace(/_/g, " ")}</Chip><Chip>{r.decision_ms.toFixed(0)} ms</Chip></>}
    >
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-4">
          <div key={flashKey} className={`px-4 py-3 border ${flashKey ? "rec-flash" : ""} ${box && !finished ? "box-pulse" : ""}`}
            style={{ borderColor: theme.c, background: theme.bg }}>
            <div className="label">Recommended action</div>
            <div className="num text-[44px] uppercase leading-none" style={{ color: theme.c }}>{headline}</div>
            <div className="text-[12px] mt-1">
              {r.compound && !finished && <span className="inline-block w-2.5 h-2.5 rounded-full mr-2 align-middle" style={{ background: COMPOUND_COLOR[r.compound] }} />}
              {subline}
            </div>
            <div className="text-[10px] text-muted mt-1">computed at lap {r.computed_at_lap}. A proposal; the car boxes only when the simulation executes it.</div>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-4 mt-4">
            <Stat label="Projected finish" value={fmtClock(r.projected_finish_s)} />
            <Stat label="Current plan finish" value={r.current_plan_projected_finish_s != null ? fmtClock(r.current_plan_projected_finish_s) : "n/a"} />
            <Stat label="Advantage vs alt." value={`${r.time_advantage_s.toFixed(1)}s`} color="#2fe08a"
              sub={`better in ${Math.round(r.scenario_win_share * r.scenarios)}/${r.scenarios} futures`} />
            <Stat label="Plans checked" value={r.candidates_evaluated} sub={`${r.candidates_feasible} feasible`} />
            <Stat label="Futures sampled" value={r.scenarios} />
            <Stat label="Decision latency" value={`${r.decision_ms.toFixed(0)} ms`} />
          </div>
        </div>

        <div className="lg:col-span-4 space-y-3">
          <div className="grid grid-cols-[120px_1fr] gap-y-3 items-center">
            <span className="label">Optimized plan</span><PlanChips plan={r.plan} empty="no further stop" />
            <span className="label">Current plan</span>
            <span className="flex items-center gap-2"><PlanChips plan={r.current_plan} empty="no further stop" />
              {r.current_plan_projected_finish_s != null && <span className="text-[11px] text-muted">{fmtClock(r.current_plan_projected_finish_s)}</span>}</span>
            <span className="label">Best alternative</span>
            <span className="flex items-center gap-2">{alt ? <><PlanChips plan={alt.plan} empty="no further stop" /><span className="text-[11px] text-muted">{fmtClock(alt.expected_s)}</span></> : <span className="text-muted text-[11px]">none</span>}</span>
            {r.action_options.map((o) => (
              <div key={o.action} className="contents">
                <span className="label">{o.action === "BOX_THIS_LAP" ? "If box now" : "If stay out"}</span>
                <span className="flex items-center gap-2"><PlanChips plan={o.best_plan} empty="no further stop" />
                  {o.projected_finish_s != null && <span className="text-[11px] text-muted">{fmtClock(o.projected_finish_s)}</span>}</span>
              </div>
            ))}
          </div>
          <p className="text-[12px] leading-relaxed text-ink/90 border-l-2 border-red pl-3">{r.explanation}</p>
          {r.warnings.length === 0
            ? <div className="text-[11px] text-green">No feasibility warnings.</div>
            : r.warnings.map((w, i) => <div key={i} className="text-[11px] text-amber border border-amber/50 px-2 py-1">{w}</div>)}
        </div>

        <div className="lg:col-span-4">
          <div className="label mb-1">Top candidates: expected finish, p10 to p90 across futures</div>
          <div className="space-y-[7px]">
            {r.top_candidates.map((c, i) => (
              <div key={i} className="grid grid-cols-[1fr_64px] gap-2 items-center text-[11px]">
                <div>
                  <PlanChips plan={c.plan} empty="no stop" />
                  <div className="relative h-[6px] bg-[#4a1a24] mt-1">
                    <div className="absolute h-full" style={{
                      left: pct((c.p10_s - lo) / span), width: pct(Math.max(0.01, (c.p90_s - c.p10_s) / span)),
                      background: i === 0 ? "#2fe08a" : "#9a4655", transition: "all 500ms ease-out" }} />
                    <div className="absolute h-[10px] w-[2px] -top-[2px] bg-white" style={{ left: pct((c.expected_s - lo) / span) }} />
                  </div>
                </div>
                <span className="text-right">{fmtClock(c.expected_s)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Panel>
  );
}
