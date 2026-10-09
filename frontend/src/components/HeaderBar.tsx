import type { RaceState } from "../types/race";
import { fmtClock, signed } from "../lib/format";
import RaceControls, { type ControlProps } from "./RaceControls";

interface Props extends ControlProps { mode: "ws" | "poll" }

const STATUS_COLOR: Record<string, string> = {
  idle: "#cfb0b4", running: "#2fe08a", paused: "#ffb020", finished: "#4fe0f7",
};

function Readout({ label, children, color }: { label: string; children: React.ReactNode; color?: string }) {
  return (
    <div className="pl-4 border-l border-[rgba(255,120,130,.28)]">
      <div className="label !text-[9px]">{label}</div>
      <div className="num text-[30px] leading-[1] tracking-wide" style={{ color }}>{children}</div>
    </div>
  );
}

export default function HeaderBar(p: Props) {
  const { state, mode, online } = p;
  const s = state.status;
  const gap = state.baseline?.gap_s ?? 0;
  return (
    <header className="relative z-20 px-4 md:px-5 pt-2 pb-2"
      style={{ background: "linear-gradient(180deg, rgba(255,59,71,.16), rgba(28,7,11,0) 100%)", borderBottom: "1px solid rgba(255,120,130,.28)" }}>
      <div className="absolute left-0 right-0 top-0 h-[3px]" style={{ background: "linear-gradient(90deg, #ff3b47, #ff3b47 28%, rgba(255,59,71,0) 80%)" }} />
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 max-w-[1920px] mx-auto">
        <div className="min-w-[200px]">
          <div className="label !text-[9px] flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full pulse-dot" style={{ background: online ? "#2fe08a" : "#ff3b47" }} />
            {online ? (mode === "ws" ? "LIVE FEED / WEBSOCKET" : "LIVE FEED / POLLING") : "BACKEND OFFLINE"}
          </div>
          <h1 className="num text-[26px] leading-[0.95] uppercase tracking-wide">
            The Impossible <span className="text-red">Pit Stop</span>
          </h1>
                  </div>

        <div className="flex items-center gap-4">
          <div className="pl-4 border-l border-[rgba(255,120,130,.28)]">
            <div className="label !text-[9px]">Status</div>
            <div className="num text-[22px] uppercase leading-[1.5]" style={{ color: STATUS_COLOR[s] }}>
              <span className="inline-block w-2 h-2 rounded-full mr-2 align-middle" style={{ background: STATUS_COLOR[s], boxShadow: `0 0 10px ${STATUS_COLOR[s]}` }} />
              {s}
            </div>
          </div>
          <Readout label="Lap">
            {String(state.lap).padStart(2, "0")}<span className="text-[18px] text-muted">/{state.total_laps}</span>
          </Readout>
          <Readout label="Elapsed">{fmtClock(state.elapsed_s)}</Readout>
          <Readout label="vs fixed-stint baseline" color={gap > 0.05 ? "#2fe08a" : gap < -0.05 ? "#ff3b47" : undefined}>
            {state.lap === 0 ? "--" : `${signed(gap)}s`}
          </Readout>
        </div>

        <div className="ml-auto">
          <RaceControls {...p} speedSelect showConfig={false} />
        </div>
      </div>
    </header>
  );
}
