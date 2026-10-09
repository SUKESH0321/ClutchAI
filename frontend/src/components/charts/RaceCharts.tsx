import {
  CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { Compound, RaceState } from "../../types/race";
import { COMPOUND_COLOR, COMPOUNDS } from "../../lib/compounds";
import { fmtLap } from "../../lib/format";
import { Chip, Panel } from "../ui/Panel";

type Row = Record<string, number | null>;

function Tip({ active, payload, label, unit }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-black/90 border border-line px-3 py-2 text-[11px]">
      <div className="label mb-1">Lap {label}</div>
      {payload.filter((p: any) => p.value != null).map((p: any) => (
        <div key={p.dataKey} style={{ color: p.color }}>
          {String(p.name)}: {unit === "wear" ? `${(p.value * 100).toFixed(1)}%` : fmtLap(p.value)}
        </div>
      ))}
    </div>
  );
}

function bands(state: RaceState) {
  const sc = state.laps.filter((l) => l.safety_car).map((l) => l.lap);
  const wet = state.laps.filter((l) => l.wetness >= 0.5).map((l) => l.lap);
  return { sc, wet };
}

function Legend() {
  return (
    <div className="flex flex-wrap gap-3 text-[10px] text-muted">
      {COMPOUNDS.map((c) => (
        <span key={c}><i className="inline-block w-3 h-[3px] mr-1 align-middle" style={{ background: COMPOUND_COLOR[c] }} />{c}</span>
      ))}
      <span><i className="inline-block w-3 border-t-2 border-dashed border-cyan mr-1 align-middle" />projected</span>
      <span><i className="inline-block w-3 h-2 mr-1 align-middle bg-amber/30" />safety car</span>
      <span><i className="inline-block w-3 h-2 mr-1 align-middle bg-wet/30" />wet track</span>
    </div>
  );
}

function build(state: RaceState, field: "wear" | "lap"): Row[] {
  const rows: Row[] = [];
  const N = state.total_laps;
  for (let lap = 1; lap <= N; lap++) rows.push({ lap, proj: null });
  state.laps.forEach((l) => {
    const r = rows[l.lap - 1];
    const v = field === "wear" ? l.wear_end : l.lap_time_s - l.pit_loss_s;
    r[l.compound] = v;
  });
  // connect compound segments across the lap boundary so lines have no gaps
  state.laps.forEach((l, i) => {
    if (i === 0) return;
    const prev = state.laps[i - 1];
    if (prev.compound !== l.compound) rows[prev.lap - 1][l.compound] = rows[prev.lap - 1][prev.compound];
  });
  (state.recommendation?.projection ?? []).forEach((p) => {
    if (p.lap <= N) rows[p.lap - 1].proj = field === "wear" ? p.wear : p.lap_time_s;
  });
  if (state.laps.length) {
    const lastRow = rows[state.laps.length - 1];
    const l = state.laps[state.laps.length - 1];
    if (lastRow.proj == null) lastRow.proj = field === "wear" ? l.wear_end : l.lap_time_s - l.pit_loss_s;
  }
  return rows;
}

function ChartShell({ state, field, title, idx, unit }: { state: RaceState; field: "wear" | "lap"; title: string; idx: string; unit: "wear" | "time" }) {
  const rows = build(state, field);
  const { sc, wet } = bands(state);
  const used = new Set<Compound>(state.laps.map((l) => l.compound));
  return (
    <Panel idx={idx} title={title} right={<Chip color="#38D9F5">actual vs projected</Chip>} bodyClassName="p-3">
      <Legend />
      <div className="h-[230px] mt-2">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 14, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#6a2431" vertical={false} />
            <XAxis dataKey="lap" stroke="#b08990" tick={{ fontSize: 10, fill: "#cfb0b4" }} />
            <YAxis stroke="#b08990" tick={{ fontSize: 10, fill: "#cfb0b4" }} width={48}
              domain={unit === "wear" ? [0, 1] : ["auto", "auto"]}
              tickFormatter={(v: number) => (unit === "wear" ? `${Math.round(v * 100)}%` : `${Math.round(v)}s`)} />
            <Tooltip content={<Tip unit={unit} />} />
            {sc.map((l) => <ReferenceArea key={`sc${l}`} x1={l - 0.5} x2={l + 0.5} fill="#FFB020" fillOpacity={0.14} />)}
            {wet.map((l) => <ReferenceArea key={`w${l}`} x1={l - 0.5} x2={l + 0.5} fill="#2F8BFF" fillOpacity={0.12} />)}
            {unit === "wear" && <ReferenceLine y={state.max_wear} stroke="#FF2D3A" strokeDasharray="4 3"
              label={{ value: "wear limit", fill: "#FF2D3A", fontSize: 10, position: "insideTopRight" }} />}
            {state.laps.filter((l) => l.pitted).map((l) => (
              <ReferenceLine key={`p${l.lap}`} x={l.lap} stroke="#FF2D3A" strokeOpacity={0.5} />
            ))}
            <ReferenceLine x={state.lap} stroke="#fff4f1" strokeOpacity={0.35} />
            <Line dataKey="proj" name="projected" stroke="#38D9F5" strokeDasharray="5 4" dot={false} strokeWidth={2} connectNulls isAnimationActive={false} />
            {COMPOUNDS.filter((c) => used.has(c)).map((c) => (
              <Line key={c} dataKey={c} name={c} stroke={COMPOUND_COLOR[c]} strokeWidth={2.5}
                dot={{ r: 2.5, fill: COMPOUND_COLOR[c], strokeWidth: 0 }} connectNulls={false} isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {unit === "time" && <div className="text-[10px] text-muted mt-1">Lap time shown without pit-lane loss; SC laps run at safety-car pace.</div>}
    </Panel>
  );
}

export function WearChart({ state }: { state: RaceState }) {
  return <ChartShell state={state} field="wear" idx="07" title="Tyre wear vs lap" unit="wear" />;
}
export function LapTimeChart({ state }: { state: RaceState }) {
  return <ChartShell state={state} field="lap" idx="08" title="Lap time vs lap" unit="time" />;
}
