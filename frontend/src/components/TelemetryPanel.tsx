import { useEffect, useRef, useState } from "react";
import type { RaceState } from "../types/race";
import { COMPOUND_COLOR, COMPOUNDS } from "../lib/compounds";
import { fmtLap, pct } from "../lib/format";
import { Chip, Panel, Stat, Tween } from "./ui/Panel";

function Flash({ value, children }: { value: string | number; children: React.ReactNode }) {
  const [k, setK] = useState(0);
  const prev = useRef(value);
  useEffect(() => {
    if (prev.current !== value) { prev.current = value; setK((x) => x + 1); }
  }, [value]);
  return <span key={k} className={k ? "flash" : ""}>{children}</span>;
}

function TyreRing({ wear, max, color, label, age }: { wear: number; max: number; color: string; label: string; age: number }) {
  const r = 46, C = 2 * Math.PI * r;
  const frac = Math.min(1, wear / max);
  const danger = frac > 0.85 ? "#ff3b47" : frac > 0.6 ? "#ffb020" : "#2fe08a";
  return (
    <svg viewBox="0 0 120 120" className="w-[132px] h-[132px] shrink-0">
      <circle cx="60" cy="60" r={r} fill="none" stroke="#6a2431" strokeWidth="12" />
      <circle cx="60" cy="60" r={r} fill="none" stroke={danger} strokeWidth="12" strokeDasharray={`${C * frac} ${C}`}
        transform="rotate(-90 60 60)" style={{ transition: "stroke-dasharray 600ms ease-out, stroke 300ms" }} />
      <circle cx="60" cy="60" r="31" fill="#2a0b11" stroke={color} strokeWidth="5" />
      <text x="60" y="58" textAnchor="middle" fill={color} fontSize="22" className="num" fontWeight="700">{label}</text>
      <text x="60" y="76" textAnchor="middle" fill="#cfb0b4" fontSize="10">{age} laps</text>
    </svg>
  );
}

const COMP_COLORS: Record<string, string> = {
  compound: "#cfb0b4", fuel: "#ffb020", wear: "#ff3b47", weather: "#2f8bff",
  traffic: "#b28cff", event: "#ffb020", noise: "#8a5a63", fuel_save: "#2fe08a", driver: "#ffffff",
};

function Light({ on, color, label }: { on: boolean; color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-[11px]" style={{ color: on ? color : "#8a5a63" }}>
      <i className={`inline-block w-2.5 h-2.5 rounded-full ${on ? "pulse-dot" : ""}`}
        style={{ background: on ? color : "#4a1a24", boxShadow: on ? `0 0 10px ${color}` : "none" }} />
      {label}
    </span>
  );
}

export default function TelemetryPanel({ state }: { state: RaceState }) {
  const car = state.car, cond = state.conditions;
  const last = state.laps[state.laps.length - 1];
  const fuelFrac = car.fuel_kg / car.fuel_initial_kg;
  const fuelCol = car.fuel_status === "OK" ? "#2fe08a" : car.fuel_status === "LOW" ? "#ffb020" : "#ff3b47";
  const comps = last ? Object.entries(last.components).filter(([k, v]) => k !== "base" && Math.abs(v as number) > 0.005) as [string, number][] : [];
  const total = comps.reduce((a, [, v]) => a + Math.abs(v), 0) || 1;
  const reserveFrac = Math.min(1, state.fuel_reserve_kg / car.fuel_initial_kg);

  return (
    <Panel idx="02" title="Live telemetry" right={<>
      <Chip color={cond.safety_car ? "#ffb020" : "#2fe08a"}>{cond.safety_car ? "Safety car" : "Green flag"}</Chip>
      <Chip>{state.status} / lap {state.lap} of {state.total_laps}</Chip></>}>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-x-8 gap-y-6">
        {/* tyres */}
        <div>
          <div className="label mb-2">Tyres</div>
          <div className="flex gap-4 items-center">
            <TyreRing wear={car.tyre_wear} max={state.max_wear} color={COMPOUND_COLOR[car.compound]}
              label={car.compound.slice(0, 1)} age={car.tyre_age} />
            <div className="grid grid-cols-2 gap-x-5 gap-y-3">
              <Stat label="Compound" value={<Flash value={car.compound}>{car.compound}</Flash>} color={COMPOUND_COLOR[car.compound]} />
              <Stat label="Wear" value={<Tween value={car.tyre_wear * 100} format={(v) => `${v.toFixed(0)}%`} />} sub={`limit ${pct(state.max_wear)}`} />
              <Stat label="Age" value={`${car.tyre_age}`} sub="laps" />
              <Stat label="Pit stops" value={car.pit_stops} />
            </div>
          </div>
          <div className="mt-4">
            <div className="label mb-1">Tyre sets available</div>
            <div className="flex gap-2">
              {COMPOUNDS.map((c) => (
                <span key={c} className="px-2 py-[2px] border text-[11px]"
                  style={{ borderColor: COMPOUND_COLOR[c] + "88", color: COMPOUND_COLOR[c], opacity: (car.tyres_available[c] ?? 0) > 0 ? 1 : 0.35 }}>
                  {c[0]} x{car.tyres_available[c] ?? 0}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* fuel + lap times */}
        <div>
          <div className="flex justify-between label"><span>Fuel</span><span style={{ color: fuelCol }}>{car.fuel_status}</span></div>
          <div className="flex items-baseline gap-3">
            <span className="num text-4xl"><Tween value={car.fuel_kg} format={(v) => v.toFixed(1)} /><span className="text-base text-muted"> kg</span></span>
            <span className="text-[11px] text-muted">projected at flag {car.fuel_projected_end_kg.toFixed(1)} kg</span>
          </div>
          <div className="h-[12px] bg-[#4a1a24] mt-1 relative sweep">
            <div className="h-full" style={{ width: pct(fuelFrac), background: fuelCol, transition: "width 600ms ease-out" }} />
            <div className="absolute top-0 bottom-0 w-[2px] bg-white" style={{ left: pct(reserveFrac) }} title="reserve" />
          </div>
          <div className="text-[10px] text-muted mt-1">white tick = reserve ({state.fuel_reserve_kg.toFixed(1)} kg)</div>
          <div className="grid grid-cols-2 gap-4 mt-4">
            <Stat label="Last lap" value={fmtLap(car.last_lap_s)} />
            <Stat label="Best lap" value={fmtLap(car.best_lap_s)} />
          </div>
        </div>

        {/* conditions */}
        <div>
          <div className="label mb-2">Conditions</div>
          <div className="grid grid-cols-2 gap-4">
            <Stat label="Track" value={cond.weather} sub={`wetness ${cond.track_wetness.toFixed(2)}`} color={cond.weather === "DRY" ? undefined : "#6db0ff"} />
            <Stat label="Rain intensity" value={cond.rain_intensity > 0 ? cond.rain_intensity.toFixed(2) : "none"} color={cond.rain_intensity > 0 ? "#6db0ff" : undefined} />
          </div>
          <div className="mt-3 h-[8px] bg-[#4a1a24]"><div className="h-full" style={{ width: pct(cond.track_wetness), background: "#2f8bff", transition: "width 600ms ease-out" }} /></div>
          <div className="flex flex-col gap-2 mt-4">
            <Light on={cond.safety_car} color="#ffb020" label={cond.safety_car ? `Safety car out (lap ${cond.sc_laps_elapsed + 1} of period)` : "Safety car in"} />
            <Light on={cond.rain_intensity > 0} color="#2f8bff" label={cond.rain_intensity > 0 ? "Rain falling" : "No rain"} />
            <Light on={state.status === "running"} color="#2fe08a" label={`Race ${state.status}`} />
          </div>
        </div>
      </div>

      <div className="mt-6">
        <div className="label mb-1">Last lap: time over base (seconds), by cause</div>
        {last ? (
          <>
            <div className="flex h-3 w-full overflow-hidden">
              {comps.map(([k, v]) => (
                <div key={k} title={`${k} ${v.toFixed(2)}s`} style={{ width: `${(Math.abs(v) / total) * 100}%`, background: COMP_COLORS[k] ?? "#888" }} />
              ))}
            </div>
            <div className="flex flex-wrap gap-x-4 text-[10px] text-muted mt-1">
              {comps.map(([k, v]) => (
                <span key={k}><i className="inline-block w-2 h-2 mr-1" style={{ background: COMP_COLORS[k] }} />{k} {v.toFixed(2)}</span>
              ))}
            </div>
          </>
        ) : <div className="text-[11px] text-muted">No laps completed yet.</div>}
      </div>
    </Panel>
  );
}
