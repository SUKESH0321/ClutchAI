import { useEffect, useRef, useState } from "react";
import type { RaceState } from "../types/race";
import { COMPOUND_COLOR, COMPOUNDS } from "../lib/compounds";
import { fmtLap, pct } from "../lib/format";
import { Chip, Panel, Stat } from "./ui/Panel";

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
  const danger = frac > 0.85 ? "#FF2D3A" : frac > 0.6 ? "#FFB020" : "#22D37A";
  return (
    <svg viewBox="0 0 120 120" className="w-[132px] h-[132px]">
      <circle cx="60" cy="60" r={r} fill="none" stroke="#1f242d" strokeWidth="12" />
      <circle cx="60" cy="60" r={r} fill="none" stroke={danger} strokeWidth="12" strokeDasharray={`${C * frac} ${C}`}
        transform="rotate(-90 60 60)" style={{ transition: "stroke-dasharray 600ms ease-out, stroke 300ms" }} />
      <circle cx="60" cy="60" r="31" fill="#0b0d11" stroke={color} strokeWidth="5" />
      <text x="60" y="58" textAnchor="middle" fill={color} fontSize="22" className="num" fontWeight="700">{label}</text>
      <text x="60" y="76" textAnchor="middle" fill="#8a93a3" fontSize="10">{age} laps</text>
    </svg>
  );
}

const COMP_COLORS: Record<string, string> = {
  compound: "#8A93A3", fuel: "#FFB020", wear: "#FF2D3A", weather: "#2F8BFF",
  traffic: "#B28CFF", event: "#FFB020", noise: "#555E6D", fuel_save: "#22D37A",
};

export default function TelemetryPanel({ state }: { state: RaceState }) {
  const car = state.car, cond = state.conditions;
  const last = state.laps[state.laps.length - 1];
  const fuelFrac = car.fuel_kg / car.fuel_initial_kg;
  const fuelCol = car.fuel_status === "OK" ? "#22D37A" : car.fuel_status === "LOW" ? "#FFB020" : "#FF2D3A";
  const comps = last ? Object.entries(last.components).filter(([k, v]) => k !== "base" && Math.abs(v) > 0.005) : [];
  const total = comps.reduce((a, [, v]) => a + Math.abs(v), 0) || 1;

  return (
    <Panel idx="02" title="Telemetry" right={<Chip color={cond.safety_car ? "#FFB020" : "#8A93A3"}>{cond.safety_car ? "SC" : "GREEN"}</Chip>}>
      <div className="flex gap-4 items-center">
        <TyreRing wear={car.tyre_wear} max={state.max_wear} color={COMPOUND_COLOR[car.compound]}
          label={car.compound.slice(0, 1)} age={car.tyre_age} />
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 flex-1">
          <Stat label="Compound" value={<Flash value={car.compound}>{car.compound}</Flash>} color={COMPOUND_COLOR[car.compound]} />
          <Stat label="Tyre wear" value={<Flash value={car.tyre_wear.toFixed(2)}>{pct(car.tyre_wear)}</Flash>}
            sub={`limit ${pct(state.max_wear)}`} />
          <Stat label="Last lap" value={fmtLap(car.last_lap_s)} />
          <Stat label="Best lap" value={fmtLap(car.best_lap_s)} />
        </div>
      </div>

      <div className="mt-4">
        <div className="flex justify-between label"><span>Fuel</span>
          <span style={{ color: fuelCol }}>{car.fuel_status}</span></div>
        <div className="flex items-baseline gap-3">
          <span className="num text-3xl">{car.fuel_kg.toFixed(1)}<span className="text-base text-muted"> kg</span></span>
          <span className="text-[11px] text-muted">projected at flag {car.fuel_projected_end_kg.toFixed(1)} kg</span>
        </div>
        <div className="h-[10px] bg-line mt-1 relative sweep">
          <div className="h-full" style={{ width: pct(fuelFrac), background: fuelCol, transition: "width 600ms ease-out" }} />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 mt-4">
        <Stat label="Pit stops" value={car.pit_stops} />
        <Stat label="Track" value={cond.weather} sub={`wetness ${cond.track_wetness.toFixed(2)}`}
          color={cond.weather === "DRY" ? undefined : "#6DB0FF"} />
        <Stat label="Rain" value={cond.rain_intensity > 0 ? cond.rain_intensity.toFixed(2) : "none"} />
      </div>

      <div className="mt-4">
        <div className="label mb-1">Tyre sets available</div>
        <div className="flex gap-2">
          {COMPOUNDS.map((c) => (
            <span key={c} className="px-2 py-[2px] border text-[11px]"
              style={{ borderColor: COMPOUND_COLOR[c] + "88", color: COMPOUND_COLOR[c] }}>
              {c[0]} x{car.tyres_available[c] ?? 0}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-4">
        <div className="label mb-1">Last lap: time over base (seconds)</div>
        {last ? (
          <>
            <div className="flex h-3 w-full overflow-hidden">
              {comps.map(([k, v]) => (
                <div key={k} title={`${k} ${v.toFixed(2)}s`}
                  style={{ width: `${(Math.abs(v) / total) * 100}%`, background: COMP_COLORS[k] ?? "#888" }} />
              ))}
            </div>
            <div className="flex flex-wrap gap-x-3 text-[10px] text-muted mt-1">
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
