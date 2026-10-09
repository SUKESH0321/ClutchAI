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
  if (!r) {
    return <Panel idx="03" title="Strategy engine"><div className="text-muted">Waiting for the first recommendation...</div></Panel>;
  }
  const box = r.action === "BOX_THIS_LAP";
  const finished = state.status === "finished";
  const lo = Math.min(...r.top_candidates.map((c) => c.p10_s));
  const hi = Math.max(...r.top_candidates.map((c) => c.p90_s));
  const span = Math.max(1, hi - lo);
  return (
    <Panel
      idx="03" title="Strategy engine"
      right={<><Chip color="#38D9F5">{r.trigger.replace(/_/g, " ")}</Chip><Chip>{r.decision_ms.toFixed(0)} ms</Chip></>}
    >
      <div className={`px-4 py-3 mb-3 border ${box && !finished ? "box-pulse" : ""}`}
        style={{ borderColor: box ? "#FF2D3A" : "#22D37A", background: box ? "rgba(255,45,58,.10)" : "rgba(34,211,122,.07)" }}>
        <div className="label">Recommended action {finished ? "(race over)" : ""}</div>
        <div className="num text-4xl uppercase leading-none" style={{ color: box ? "#FF2D3A" : "#22D37A" }}>
          {box ? `Box this lap` : "Stay out"}
          {r.compound && <span style={{ color: COMPOUND_COLOR[r.compound] }}> {box ? "-> " : "/ next "}{r.compound}</span>}
        </div>
        <div className="text-[11px] text-muted mt-1">
          {r.pit_lap != null ? `Pit lap ${r.pit_lap}` : "No further stop planned"} - computed at lap {r.computed_at_lap}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Stat label="Projected finish" value={fmtClock(r.projected_finish_s)} />
        <Stat label="Advantage vs alt." value={`${r.time_advantage_s.toFixed(1)}s`} color="#22D37A"
          sub={`${Math.round(r.scenario_win_share * r.scenarios)}/${r.scenarios} futures`} />
        <Stat label="Plans checked" value={r.candidates_evaluated}
          sub={`${r.candidates_feasible} feasible, ${r.scenarios} futures`} />
      </div>

      <div className="mt-3 grid grid-cols-[110px_1fr] gap-y-2 items-center">
        <span className="label">Optimized plan</span><PlanChips plan={r.plan} empty="no further stop" />
        <span className="label">Current plan</span>
        <span className="flex items-center gap-2"><PlanChips plan={r.current_plan} empty="no further stop" />
          {r.current_plan_projected_finish_s != null && (
            <span className="text-[11px] text-muted">{fmtClock(r.current_plan_projected_finish_s)}</span>)}
        </span>
        {r.action_options.map((o) => (
          <div key={o.action} className="contents">
            <span className="label">{o.action === "BOX_THIS_LAP" ? "If box now" : "If stay out"}</span>
            <span className="flex items-center gap-2">
              <PlanChips plan={o.best_plan} empty="no further stop" />
              {o.projected_finish_s != null && <span className="text-[11px] text-muted">{fmtClock(o.projected_finish_s)}</span>}
            </span>
          </div>
        ))}
      </div>

      <p className="mt-3 text-[12px] leading-relaxed text-ink/90 border-l-2 border-red pl-3">{r.explanation}</p>
      {r.warnings.map((w, i) => (
        <div key={i} className="mt-2 text-[11px] text-amber border border-amber/50 px-2 py-1">{w}</div>
      ))}

      <div className="mt-4">
        <div className="label mb-1">Top candidates (expected finish, p10-p90 across futures)</div>
        <div className="space-y-[6px]">
          {r.top_candidates.map((c, i) => (
            <div key={i} className="grid grid-cols-[1fr_72px] gap-2 items-center text-[11px]">
              <div>
                <PlanChips plan={c.plan} empty="no stop" />
                <div className="relative h-[6px] bg-line mt-1">
                  <div className="absolute h-full" style={{
                    left: pct((c.p10_s - lo) / span), width: pct(Math.max(0.01, (c.p90_s - c.p10_s) / span)),
                    background: i === 0 ? "#22D37A" : "#3a4250" }} />
                  <div className="absolute h-[10px] w-[2px] -top-[2px] bg-white" style={{ left: pct((c.expected_s - lo) / span) }} />
                </div>
              </div>
              <span className="text-right">{fmtClock(c.expected_s)}</span>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}
