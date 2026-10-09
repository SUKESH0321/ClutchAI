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
      <text x="8" y={y + 24} fill="#fff4f1" fontSize="13" className="num" style={{ textTransform: "uppercase" }}>{name}</text>
      <rect x={left} y={y} width={W - left - right} height="34" fill="#2a0b11" stroke="#6a2431" />
      {segs.map((s, i) => (
        <g key={i}>
          <rect x={x(s.from)} y={y + 2} width={Math.max(2, w(s.from, s.to) - 2)} height="30"
            fill={s.planned ? "url(#hatch)" : COMPOUND_COLOR[s.compound]} fillOpacity={s.planned ? 1 : 0.85}
            stroke={COMPOUND_COLOR[s.compound]} strokeDasharray={s.planned ? "4 3" : undefined} />
          <text x={x(s.from) + 6} y={y + 22} fontSize="12" fill={s.planned ? COMPOUND_COLOR[s.compound] : "#1c070b"} className="num">
            {s.compound}
          </text>
          {i > 0 && (() => {
            const next = s.planned && !segs.slice(0, i).some((q, j) => j > 0 && q.planned);
            const d = `M ${x(s.from) - 1} ${y - 6} l 7 -10 l -14 0 z`;
            return s.planned
              ? <path d={d} fill={next ? "#4fe0f7" : "none"} stroke={next ? "#4fe0f7" : "#ffb020"} strokeWidth="2" className={next ? "pulse-dot" : ""} />
              : <path d={d} fill="#ff3b47" />;
          })()}
        </g>
      ))}
    </g>
  );

  return (
    <Panel idx="09" title="Strategy timeline" right={<><Chip color="#38D9F5">hatched = planned</Chip></>} bodyClassName="p-3">
      <svg viewBox={`0 0 ${W} 130`} className="w-full" role="img" aria-label="Stint timeline for adaptive car and baseline">
        <defs>
          <pattern id="hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="7" height="7" fill="#2a0b11" /><rect width="2" height="7" fill="#38D9F5" fillOpacity="0.35" />
          </pattern>
        </defs>
        {Array.from({ length: N }, (_, i) => (
          <g key={i}>
            <line x1={x(i + 1)} x2={x(i + 1)} y1="28" y2="118" stroke="#6a2431" />
            {(i + 1) % 5 === 0 || i === 0 ? <text x={x(i + 1) + 2} y="20" fontSize="10" fill="#cfb0b4">{i + 1}</text> : null}
          </g>
        ))}
        {lane(adaptive, 34, "Adaptive")}
        {lane(base, 84, "Baseline")}
        {state.lap > 0 && <line x1={x(state.lap + 1)} x2={x(state.lap + 1)} y1="26" y2="124" stroke="#fff" strokeWidth="2" />}
      </svg>
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-[11px] text-muted mt-2">
        <span><svg width="14" height="12" className="inline mr-1"><path d="M7 1 L13 11 L1 11 Z" fill="#ff3b47" /></svg>completed pit stop</span>
        <span><svg width="14" height="12" className="inline mr-1"><path d="M7 1 L13 11 L1 11 Z" fill="none" stroke="#ffb020" strokeWidth="2" /></svg>planned stop</span>
        <span><svg width="14" height="12" className="inline mr-1"><path d="M7 1 L13 11 L1 11 Z" fill="#4fe0f7" /></svg>next recommended stop</span>
        <span>hatched = planned stint, solid = driven stint</span>
        <span>white line = current lap boundary</span>
        <span>baseline lane shows only what the fixed-stint car has actually done (same events)</span>
      </div>
    </Panel>
  );
}
