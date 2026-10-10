import { useEffect, useRef, useState } from "react";
import type { RaceState } from "../types/race";
import BenchmarkPanel from "./BenchmarkPanel";
import EventControls from "./EventControls";
import EventLog from "./EventLog";
import RaceControls, { type ControlProps } from "./RaceControls";
import StrategyPanel from "./StrategyPanel";
import TelemetryPanel from "./TelemetryPanel";
import StrategyTimeline from "./charts/StrategyTimeline";
import { LapTimeChart, WearChart } from "./charts/RaceCharts";
import { Chip, FlatContext } from "./ui/Panel";

export type TabId = "telemetry" | "strategy" | "timeline" | "analytics" | "events";
export const TABS: { id: TabId; label: string }[] = [
  { id: "telemetry", label: "Telemetry" },
  { id: "strategy", label: "Strategy engine" },
  { id: "timeline", label: "Timeline" },
  { id: "analytics", label: "Analytics" },
  { id: "events", label: "Events & controls" },
];

interface Props extends ControlProps {
  open: boolean;
  onClose: () => void;
  tab: TabId;
  setTab: (t: TabId) => void;
  error: string | null;
}

const STATUS_COLOR: Record<string, string> = { idle: "#cfb0b4", running: "#2fe08a", paused: "#ffb020", finished: "#4fe0f7" };

export default function ConsoleDrawer(p: Props) {
  const { state, open, onClose, tab, setTab } = p;
  // keep content mounted only while visible (plus the closing transition) so charts don't run when hidden
  const [mounted, setMounted] = useState(open);
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) { setMounted(true); return; }
    const t = window.setTimeout(() => setMounted(false), 380);
    return () => window.clearTimeout(t);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  useEffect(() => { bodyRef.current?.scrollTo({ top: 0 }); }, [tab]);

  const onTabKey = (e: React.KeyboardEvent) => {
    const i = TABS.findIndex((t) => t.id === tab);
    if (e.key === "ArrowRight") setTab(TABS[(i + 1) % TABS.length].id);
    if (e.key === "ArrowLeft") setTab(TABS[(i + TABS.length - 1) % TABS.length].id);
  };

  return (
    <aside id="race-console" className="console" data-open={open} role="dialog" aria-label="Race control and live telemetry" aria-hidden={!open}>
      <div className="flex items-center gap-3 px-5 pt-3 shrink-0">
        <span className="tick" />
        <h2 className="num text-[22px] uppercase tracking-wide leading-none">
          Race control <span className="text-muted">/</span> live telemetry
        </h2>
        <span className="hidden sm:flex items-center gap-2 ml-2">
          <Chip color={STATUS_COLOR[state.status]}>{state.status}</Chip>
          <Chip color="#FF3B47">{state.track?.name ?? state.circuit_id}</Chip>
          <Chip>Lap {state.lap}/{state.total_laps}</Chip>
          {state.conditions.safety_car && <Chip color="#ffb020">Safety car</Chip>}
          {state.conditions.weather !== "DRY" && <Chip color="#2f8bff">{state.conditions.weather}</Chip>}
        </span>
        <button type="button" onClick={onClose} aria-label="Close console"
          className="ml-auto grid place-items-center w-9 h-9 rounded-full border border-[rgba(255,120,130,.4)] hover:bg-[rgba(255,59,71,.25)] transition-colors">
          <svg viewBox="0 0 24 24" width="16" height="16"><path d="M5 5l14 14M19 5L5 19" stroke="#fff4f1" strokeWidth="2.4" strokeLinecap="round" /></svg>
        </button>
      </div>

      <div role="tablist" aria-label="Console sections" onKeyDown={onTabKey}
        className="flex gap-1 px-4 mt-2 overflow-x-auto overflow-y-hidden shrink-0 border-b border-[rgba(255,120,130,.22)]">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} id={`tab-${t.id}`} aria-controls={`pane-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1} className="tab-btn" onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      <div ref={bodyRef} className="console-body">
        {mounted && (
          <FlatContext.Provider value>
            <div key={tab} role="tabpanel" id={`pane-${tab}`} aria-labelledby={`tab-${tab}`} className="tab-pane">
              {tab === "telemetry" && <TelemetryPanel state={state} />}
              {tab === "strategy" && <StrategyPanel state={state} />}
              {tab === "timeline" && <StrategyTimeline state={state} />}
              {tab === "analytics" && (
                <div className="space-y-4">
                  <div className="text-[11px] text-muted flex flex-wrap gap-x-5 gap-y-1">
                    <span><b className="text-ink">Solid lines</b>: measured, output of the race simulation</span>
                    <span><b className="text-cyan">Dashed cyan</b>: projected by the optimizer (scenario 0 of the plan)</span>
                    <span><b className="text-ink">Benchmark</b>: simulated paired races, not real-world data</span>
                  </div>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <WearChart state={state} />
                    <LapTimeChart state={state} />
                  </div>
                  <BenchmarkPanel circuitId={state.circuit_id} circuitName={state.track?.name ?? state.circuit_id} />
                </div>
              )}
              {tab === "events" && (
                <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
                  <div className="lg:col-span-2 space-y-4">
                    <div className="flat-section p-3">
                      <div className="label mb-2">Race controls</div>
                      <RaceControls {...p} compact />
                    </div>
                    <EventControls state={state} act={p.act} busy={p.busy} error={p.error} />
                  </div>
                  <div className="lg:col-span-3"><EventLog state={state} /></div>
                </div>
              )}
            </div>
          </FlatContext.Provider>
        )}
      </div>
    </aside>
  );
}
