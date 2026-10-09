import { api } from "../services/api";
import type { RaceState } from "../types/race";

export interface ControlProps {
  state: RaceState;
  online: boolean;
  configs: string[];
  config: string;
  setConfig: (c: string) => void;
  act: (fn: () => Promise<RaceState>) => void;
  busy: boolean;
}

const SPEEDS = [0.5, 1, 2, 4, 8, 16];

/** Start/pause/resume/step/finish/reset + config + speed. Single implementation, used by the header
 *  and the console's events tab so both always share the same handlers and state. */
export default function RaceControls({ state, online, configs, config, setConfig, act, busy, compact = false, speedSelect = false, showConfig = true }: ControlProps & { compact?: boolean; speedSelect?: boolean; showConfig?: boolean }) {
  const s = state.status;
  const dis = busy || !online;
  const small = compact ? "!px-3 !py-[4px] !text-[14px]" : "!px-[10px] !py-[4px] !text-[14px]";
  return (
    <div className={`flex flex-wrap items-center gap-2 ${compact ? "" : "justify-end"}`}>
      <button className={`btn btn-primary ${small}`} disabled={dis || s !== "idle"} onClick={() => act(api.start)}>Start</button>
      <button className={`btn ${small}`} disabled={dis || s !== "running"} onClick={() => act(api.pause)}>Pause</button>
      <button className={`btn ${small}`} disabled={dis || s !== "paused"} onClick={() => act(api.resume)}>Resume</button>
      <button className={`btn ${small}`} disabled={dis || (s !== "idle" && s !== "paused")} onClick={() => act(api.step)}>Step lap</button>
      <button className={`btn ${small}`} disabled={dis || s === "finished"} onClick={() => act(api.finish)}>Finish</button>
      {showConfig && (
      <select className={`btn ${small}`} value={config} onChange={(e) => setConfig(e.target.value)} aria-label="Race configuration">
          {configs.map((c) => <option key={c} value={c} style={{ background: "#2a0a10" }}>{c}</option>)}
        </select>
      )}
      <button className={`btn btn-amber ${small}`} disabled={dis} onClick={() => act(() => api.reset(config))}>Reset</button>
      {speedSelect ? (
        <label className="flex items-center gap-1 ml-1">
          <span className="label">Speed</span>
          <select className={`btn ${small}`} value={state.speed} disabled={dis} aria-label="Simulation speed"
            onChange={(e) => act(() => api.speed(Number(e.target.value)))}>
            {SPEEDS.map((v) => <option key={v} value={v} style={{ background: "#2a0a10" }}>{v}x</option>)}
          </select>
        </label>
      ) : (
        <span className="flex items-center gap-1 ml-1">
          <span className="label mr-1">Speed</span>
          {SPEEDS.map((v) => (
            <button key={v} disabled={dis} onClick={() => act(() => api.speed(v))}
              className={`btn !px-2 !py-[3px] !text-[13px] ${state.speed === v ? "btn-primary" : ""}`}>{v}x</button>
          ))}
        </span>
      )}
    </div>
  );
}
