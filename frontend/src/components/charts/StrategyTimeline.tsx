import type { Compound, RaceState } from "../../types/race";
import { COMPOUND_COLOR } from "../../lib/compounds";
import { Chip, Panel } from "../ui/Panel";

interface Seg { compound: Compound; from: number; to: number; planned: boolean }

export default function StrategyTimeline({ state }: { state: RaceState }) {
  const N = state.total_laps;
  const W = 1000, left = 150, right = 20;
  const x = (lap: number) => left + ((lap - 1) / N) * (W - left - right);
  const w = (a: number, b: number) => ((b - a + 1) / N) * (W - left - right);

  const adaptive: Seg[] = state.stints
    .filter((s) => (s.end_lap ?? state.lap) >= s.start_lap)
    .map((s) => ({ compound: s.compound, from: s.start_lap, to: s.end_lap ?? state.lap, planned: false }));
  const rec = state.recommendation;
  if (rec && state.status !== "finished" && state.lap < N) {
    const cur = state.stints[state.stints.length - 1];
    const stops = rec.plan.filter((p) => p.lap > state.lap);
    let from = state.lap + 1;
    let comp = cur.compound;
    for (const p of stops) {
      adaptive.push({ compound: comp, from, to: p.lap, planned: true });
      from = p.lap + 1;
      comp = p.compound;
    }
    adaptive.push({ compound: comp, from, to: N, planned: true });
  }
  const base: Seg[] = (state.baseline?.stints ?? [])
    .filter((s) => (s.end_lap ?? state.lap) >= s.start_lap)
    .map((s) => ({ compound: s.compound, from: s.start_lap, to: s.end_lap ?? state.lap, planned: false }));

  const lane = (segs: Seg[], y: number, name: string) => (
    <g>
      <text x="8" y={y + 24} fill="#E8EAED" fontSize="13" className="num" style={{ textTransform: "uppercase" }}>{name}</text>
      <rect x={left} y={y} width={W - left - right} height="34" fill="#0b0d11" stroke="#1f242d" />
      {segs.map((s, i) => (
        <g key={i}>
          <rect x={x(s.from)} y={y + 2} width={Math.max(2, w(s.from, s.to) - 2)} height="30"
            fill={s.planned ? "url(#hatch)" : COMPOUND_COLOR[s.compound]} fillOpacity={s.planned ? 1 : 0.85}
            stroke={COMPOUND_COLOR[s.compound]} strokeDasharray={s.planned ? "4 3" : undefined} />
          <text x={x(s.from) + 6} y={y + 22} fontSize="12" fill={s.planned ? COMPOUND_COLOR[s.compound] : "#07080A"} className="num">
            {s.compound}
          </text>
          {i > 0 && <path d={`M ${x(s.from) - 1} ${y - 6} l 6 -8 l -12 0 z`} fill="#FF2D3A" />}
        </g>
      ))}
    </g>
  );

  return (
    <Panel idx="09" title="Strategy timeline" right={<><Chip color="#38D9F5">hatched = planned</Chip></>} bodyClassName="p-3">
      <svg viewBox={`0 0 ${W} 150`} className="w-full" role="img" aria-label="Stint timeline for adaptive car and baseline">
        <defs>
          <pattern id="hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="7" height="7" fill="#0b0d11" /><rect width="2" height="7" fill="#38D9F5" fillOpacity="0.35" />
          </pattern>
        </defs>
        {Array.from({ length: N }, (_, i) => (
          <g key={i}>
            <line x1={x(i + 1)} x2={x(i + 1)} y1="28" y2="118" stroke="#1f242d" />
            {(i + 1) % 5 === 0 || i === 0 ? <text x={x(i + 1) + 2} y="20" fontSize="10" fill="#8a93a3">{i + 1}</text> : null}
          </g>
        ))}
        {lane(adaptive, 34, "Adaptive")}
        {lane(base, 84, "Baseline")}
        {state.lap > 0 && <line x1={x(state.lap + 1)} x2={x(state.lap + 1)} y1="26" y2="124" stroke="#fff" strokeWidth="2" />}
        <text x={left} y="146" fontSize="10" fill="#8a93a3">Red triangles mark pit stops. The white line is the current lap boundary.</text>
      </svg>
    </Panel>
  );
}
