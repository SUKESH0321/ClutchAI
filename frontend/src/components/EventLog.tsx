import type { RaceState } from "../types/race";
import { fmtClock } from "../lib/format";
import { Panel } from "./ui/Panel";

const COLORS: Record<string, string> = {
  RACE_STARTED: "#22D37A", RACE_FINISHED: "#38D9F5", PIT_STOP: "#FF2D3A", FORCED_PIT: "#FF2D3A",
  STRATEGY_RECALCULATED: "#38D9F5", RECOMMENDATION_CHANGED: "#B28CFF", SC_DEPLOYED: "#FFB020",
  SC_WITHDRAWN: "#FFB020", RAIN_STARTED: "#2F8BFF", RAIN_CHANGED: "#2F8BFF", RAIN_STOPPED: "#2F8BFF",
  WEATHER_CHANGED: "#2F8BFF", MANUAL_EVENT: "#fff4f1", WARNING: "#FFB020", PAUSED: "#cfb0b4", RESUMED: "#cfb0b4",
};

export default function EventLog({ state }: { state: RaceState }) {
  const rows = [...state.events].reverse();
  return (
    <Panel idx="06" title="Event log" right={<span className="label">{state.events.length} events</span>} bodyClassName="p-0">
      <div className="max-h-[330px] overflow-y-auto">
        {rows.map((e) => (
          <div key={e.id} className="flex gap-3 px-4 py-[6px] border-b border-line/70 text-[11px] hover:bg-white/[0.03]">
            <span className="w-[3px] shrink-0" style={{ background: COLORS[e.type] ?? "#555" }} />
            <span className="text-muted w-[92px] shrink-0">L{String(e.lap).padStart(2, "0")} {fmtClock(e.sim_time_s)}</span>
            <span className="w-[150px] shrink-0 uppercase tracking-wider" style={{ color: COLORS[e.type] ?? "#999" }}>
              {e.type.replace(/_/g, " ")}
            </span>
            <span className="text-ink/90">{e.message}</span>
          </div>
        ))}
        {rows.length === 0 && <div className="p-4 text-muted">No events yet.</div>}
      </div>
    </Panel>
  );
}
