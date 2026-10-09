import { api } from "../services/api";
import type { RaceState } from "../types/race";
import { Panel } from "./ui/Panel";

interface Props {
  state: RaceState;
  act: (fn: () => Promise<RaceState>) => void;
  busy: boolean;
  error: string | null;
}

export default function EventControls({ state, act, busy, error }: Props) {
  const over = state.status === "finished";
  const raining = state.conditions.rain_intensity > 0;
  const sc = state.conditions.safety_car;
  const off = busy || over;
  const refresh = async () => {
    await api.recommendation(true);
    return api.state();
  };
  return (
    <Panel idx="05" title="Race control / inject events">
      <p className="text-[11px] text-muted mb-3">
        These change the hidden race both cars are driving in. Events apply from the next lap, and the optimizer replans immediately.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <button className="btn btn-blue" disabled={off} onClick={() => act(() => api.event({ type: "RAIN", intensity: 0.4 }))}>Light rain</button>
        <button className="btn btn-blue" disabled={off} onClick={() => act(() => api.event({ type: "RAIN", intensity: 0.8 }))}>Heavy rain</button>
        <button className="btn col-span-2" disabled={off || !raining} onClick={() => act(() => api.event({ type: "CLEAR" }))}>Clear rain</button>
        <button className="btn btn-amber" disabled={off || sc} onClick={() => act(() => api.event({ type: "SC_DEPLOY" }))}>Deploy safety car</button>
        <button className="btn btn-amber" disabled={off || !sc} onClick={() => act(() => api.event({ type: "SC_WITHDRAW" }))}>Withdraw safety car</button>
        <button className="btn col-span-2" disabled={off} onClick={() => act(refresh)}>Force strategy refresh</button>
      </div>
      {error && <div className="mt-3 text-[11px] text-red border border-red/50 px-2 py-1">{error}</div>}
    </Panel>
  );
}
