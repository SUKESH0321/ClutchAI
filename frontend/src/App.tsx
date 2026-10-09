import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./services/api";
import { useRaceState } from "./hooks/useRaceState";
import type { RaceState } from "./types/race";
import HeaderBar from "./components/HeaderBar";
import RaceView from "./components/RaceView";
import { RaceClock } from "./lib/raceClock";
import TelemetryPanel from "./components/TelemetryPanel";
import StrategyPanel from "./components/StrategyPanel";
import EventControls from "./components/EventControls";
import EventLog from "./components/EventLog";
import BenchmarkPanel from "./components/BenchmarkPanel";
import StrategyTimeline from "./components/charts/StrategyTimeline";
import { LapTimeChart, WearChart } from "./components/charts/RaceCharts";

export default function App() {
  const { state, mode, online, apply } = useRaceState();
  const [configs, setConfigs] = useState<string[]>(["demo"]);
  const [config, setConfig] = useState("demo");
  const clock = useMemo(() => new RaceClock(), []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.configs().then(setConfigs).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (state && configs.includes(state.config_name)) setConfig(state.config_name);
  }, [state?.config_name, configs.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (state) clock.update(state);
  }, [state, clock]);

  const act = useCallback((fn: () => Promise<RaceState>) => {
    setBusy(true);
    setError(null);
    fn()
      .then(apply)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  }, [apply]);

  if (!state) {
    return (
      <div className="min-h-screen grid place-items-center">
        <div className="text-center">
          <div className="num text-5xl uppercase">The Impossible <span className="text-red">Pit Stop</span></div>
          <div className="label mt-3 pulse-dot">{online ? "Loading race state" : "Connecting to the strategy backend on :8000"}</div>
          <div className="text-[11px] text-muted mt-2">Start it with: python -m uvicorn app.main:app --port 8000 (from backend/)</div>
        </div>
      </div>
    );
  }

  return (
    <main className="max-w-[1680px] mx-auto p-3 md:p-5 space-y-4">
      <HeaderBar state={state} mode={mode} online={online} configs={configs} config={config}
        setConfig={setConfig} act={act} busy={busy} />
      {error && <div className="text-red border border-red/60 px-3 py-2 text-[12px]">{error}</div>}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <div className="xl:col-span-8"><RaceView state={state} clock={clock} /></div>
        <div className="xl:col-span-4 space-y-4">
          <TelemetryPanel state={state} />
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <div className="xl:col-span-5"><StrategyPanel state={state} /></div>
        <div className="xl:col-span-7 space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <WearChart state={state} />
            <LapTimeChart state={state} />
          </div>
          <StrategyTimeline state={state} />
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <div className="xl:col-span-4"><EventControls state={state} act={act} busy={busy} error={null} /></div>
        <div className="xl:col-span-8"><EventLog state={state} /></div>
      </div>

      <BenchmarkPanel />

      <footer className="label text-center pb-6">
        Synthetic fictional race model - parameters are illustrative, not calibrated to real motorsport data.
      </footer>
    </main>
  );
}
