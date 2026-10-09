import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./services/api";
import { useRaceState } from "./hooks/useRaceState";
import type { RaceState } from "./types/race";
import HeaderBar from "./components/HeaderBar";
import RaceView from "./components/RaceView";
import WheelButton from "./components/WheelButton";
import ConsoleDrawer, { type TabId } from "./components/ConsoleDrawer";
import { RaceClock } from "./lib/raceClock";

export default function App() {
  const { state, mode, online, apply } = useRaceState();
  const [configs, setConfigs] = useState<string[]>(["demo"]);
  const [config, setConfig] = useState("demo");
  const clock = useMemo(() => new RaceClock(), []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<TabId>("telemetry");

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

  const toggle = useCallback(() => setOpen((o) => !o), []);
  const close = useCallback(() => setOpen(false), []);

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

  const controls = { state, online, configs, config, setConfig, act, busy };
  const rec = state.recommendation;
  const badge = rec?.action === "BOX_THIS_LAP" && state.status !== "finished" && !open ? "BOX" : null;

  return (
    <div className="h-screen min-h-[640px] flex flex-col overflow-hidden">
      <HeaderBar {...controls} mode={mode} />
      {error && (
        <div role="alert" className="mx-4 mt-2 text-[12px] px-3 py-2 flex items-center gap-3"
          style={{ background: "rgba(120,10,25,.55)", border: "1px solid #ff3b47" }}>
          <span className="flex-1">{error}</span>
          <button className="underline" onClick={() => setError(null)}>dismiss</button>
        </div>
      )}
      <RaceView state={state} clock={clock} drawerOpen={open} />
      <WheelButton open={open} onClick={toggle} badge={badge} />
      <ConsoleDrawer {...controls} open={open} onClose={close} tab={tab} setTab={setTab} error={error} />
    </div>
  );
}
