import { api } from "../services/api";
import type { RaceState } from "../types/race";
import { fmtClock, signed } from "../lib/format";
import { Chip } from "./ui/Panel";

interface Props {
  state: RaceState;
  mode: "ws" | "poll";
  online: boolean;
  configs: string[];
  config: string;
  setConfig: (c: string) => void;
  act: (fn: () => Promise<RaceState>) => void;
  busy: boolean;
}

const STATUS_COLOR: Record<string, string> = {
  idle: "#8A93A3", running: "#22D37A", paused: "#FFB020", finished: "#38D9F5",
};
const SPEEDS = [0.5, 1, 2, 4, 8, 16];

export default function HeaderBar({ state, mode, online, configs, config, setConfig, act, busy }: Props) {
  const s = state.status;
  const gap = state.baseline?.gap_s ?? 0;
  const dis = busy || !online;
  return (
    <header className="panel fade-in">
      <div className="panel-in px-5 py-3 flex flex-wrap items-center gap-x-8 gap-y-3">
        <div className="min-w-[230px]">
          <div className="label flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full pulse-dot" style={{ background: online ? "#22D37A" : "#FF2D3A" }} />
            {online ? (mode === "ws" ? "LIVE FEED / WEBSOCKET" : "LIVE FEED / POLLING") : "BACKEND OFFLINE"}
          </div>
          <h1 className="num text-[34px] leading-[0.95] tracking-wide uppercase">
            The Impossible <span className="text-red">Pit Stop</span>
          </h1>
          <div className="label mt-1">Race Strategist / rolling-horizon optimizer</div>
        </div>

        <div className="flex items-end gap-6">
          <div>
            <div className="label">Status</div>
            <Chip color={STATUS_COLOR[s]}>{s}</Chip>
          </div>
          <div>
            <div className="label">Lap</div>
            <div className="num text-6xl leading-none">
              {String(state.lap).padStart(2, "0")}
              <span className="text-2xl text-muted">/{state.total_laps}</span>
            </div>
          </div>
          <div>
            <div className="label">Elapsed</div>
            <div className="num text-4xl leading-none">{fmtClock(state.elapsed_s)}</div>
          </div>
          <div>
            <div className="label">vs fixed-stint baseline</div>
            <div className="num text-4xl leading-none" style={{ color: gap > 0.05 ? "#22D37A" : gap < -0.05 ? "#FF2D3A" : "#E8EAED" }}>
              {state.lap === 0 ? "--" : `${signed(gap)}s`}
            </div>
          </div>
        </div>

        <div className="ml-auto flex flex-col gap-2 items-end">
          <div className="flex flex-wrap gap-2 justify-end">
            <button className="btn btn-primary" disabled={dis || s !== "idle"} onClick={() => act(api.start)}>Start</button>
            <button className="btn" disabled={dis || s !== "running"} onClick={() => act(api.pause)}>Pause</button>
            <button className="btn" disabled={dis || s !== "paused"} onClick={() => act(api.resume)}>Resume</button>
            <button className="btn" disabled={dis || (s !== "idle" && s !== "paused")} onClick={() => act(api.step)}>Step lap</button>
            <button className="btn" disabled={dis || s === "finished"} onClick={() => act(api.finish)}>Finish</button>
            <select
              className="btn bg-surface"
              value={config}
              onChange={(e) => setConfig(e.target.value)}
              aria-label="Race configuration"
            >
              {configs.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <button className="btn btn-amber" disabled={dis} onClick={() => act(() => api.reset(config))}>Reset</button>
          </div>
          <div className="flex items-center gap-1">
            <span className="label mr-2">Sim speed</span>
            {SPEEDS.map((v) => (
              <button
                key={v}
                disabled={dis}
                onClick={() => act(() => api.speed(v))}
                className={`btn !px-3 !py-[3px] !text-[13px] ${state.speed === v ? "btn-primary" : ""}`}
              >
                {v}x
              </button>
            ))}
          </div>
        </div>
      </div>
    </header>
  );
}
