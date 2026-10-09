import { useMemo, useState } from "react";
import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useBenchmark } from "../hooks/useBenchmark";
import { fmtClock, pct } from "../lib/format";
import { Chip, Panel, Stat } from "./ui/Panel";

export default function BenchmarkPanel() {
  const { results, status, error, run } = useBenchmark();
  const [trials, setTrials] = useState(100);
  const [seed, setSeed] = useState(10000);
  const running = status.state === "running";
  const s = results?.summary;

  const hist = useMemo(() => {
    if (!results) return [];
    const v = results.trials.filter((t) => t.completed && t.saved_s != null).map((t) => t.saved_s as number);
    if (!v.length) return [];
    const bw = 5;
    const lo = Math.floor(Math.min(...v) / bw) * bw, hi = Math.ceil((Math.max(...v) + 1e-9) / bw) * bw;
    const bins = [];
    for (let a = lo; a < hi; a += bw) bins.push({ from: a, label: `${a}`, n: v.filter((x) => x >= a && x < a + bw).length });
    return bins;
  }, [results]);

  const cats = s ? Object.entries(s.by_category).map(([k, c]) => ({ k, ...c })) : [];

  return (
    <Panel
      idx="10" title="Benchmark / adaptive vs fixed-stint baseline (paired trials)"
      right={s ? <><Chip color={s.seed_set === "eval" ? "#22D37A" : "#FFB020"}>{s.seed_set} seeds</Chip><Chip>{s.trials} trials</Chip></> : undefined}
    >
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <label className="label">Trials
          <input type="number" min={1} max={500} value={trials} onChange={(e) => setTrials(Number(e.target.value))}
            className="block bg-surface border border-line px-2 py-1 w-24 text-ink" />
        </label>
        <label className="label">Seed start
          <input type="number" min={0} value={seed} onChange={(e) => setSeed(Number(e.target.value))}
            className="block bg-surface border border-line px-2 py-1 w-28 text-ink" />
        </label>
        <button className="btn btn-primary" disabled={running || trials < 1} onClick={() => run(trials, seed)}>
          {running ? "Running..." : "Run benchmark"}
        </button>
        {running && (
          <div className="flex-1 min-w-[200px]">
            <div className="label">{status.completed}/{status.total} races simulated (both strategies each)</div>
            <div className="h-2 bg-line sweep"><div className="h-full bg-red" style={{ width: pct(status.completed / Math.max(1, status.total)) }} /></div>
          </div>
        )}
        {(error || status.error) && <span className="text-red text-[11px]">{error || status.error}</span>}
        <span className="text-[10px] text-muted ml-auto max-w-[360px]">
          Seeds 10000+ are the held-out evaluation set; seeds 1-999 were used for tuning. Both strategies face an identical hidden world per seed.
        </span>
      </div>

      {!s ? (
        <div className="text-muted py-8 text-center border border-dashed border-line">
          No benchmark results yet. Run one above (or `python -m app.evaluation` in backend/).
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-x-6 gap-y-4">
            <Stat label="Baseline mean" value={fmtClock(s.baseline_mean_s)} />
            <Stat label="Adaptive mean" value={fmtClock(s.adaptive_mean_s)} />
            <Stat label="Mean time saved" value={`${s.mean_saved_s.toFixed(2)}s`} color={s.mean_saved_s >= 0 ? "#22D37A" : "#FF2D3A"}
              sub={`95% CI ${s.ci95_saved_s[0].toFixed(1)} to ${s.ci95_saved_s[1].toFixed(1)}`} />
            <Stat label="Improvement" value={`${s.pct_improvement.toFixed(3)}%`} color={s.pct_improvement >= 0 ? "#22D37A" : "#FF2D3A"} />
            <Stat label="Win rate" value={pct(s.win_rate, 1)} sub={`${s.wins}W / ${s.losses}L / ${s.ties}T`} />
            <Stat label="Std dev (saved)" value={`${s.std_saved_s.toFixed(2)}s`} sub={`median ${s.median_saved_s.toFixed(2)}s`} />
            <Stat label="Trials" value={s.completed} sub={s.failed_trials ? `${s.failed_trials} failed` : "0 failed"} />
            <Stat label="Invalid plans" value={s.invalid_plans} sub={`baseline ${s.baseline_invalid_plans}`} />
            <Stat label="Tyre violations" value={s.tyre_violations} sub={`baseline ${s.baseline_tyre_violations}`} />
            <Stat label="Decision time" value={`${s.mean_decision_ms.toFixed(0)} ms`} sub={`p95 ${s.p95_decision_ms.toFixed(0)} ms`} />
            <Stat label="Futures / decision" value={s.scenarios} />
            <Stat label="Runtime" value={`${s.runtime_s.toFixed(0)}s`} sub={s.created_at.slice(0, 19).replace("T", " ") + " UTC"} />
          </div>

          <div className="grid md:grid-cols-2 gap-6 mt-6">
            <div>
              <div className="label mb-1">Time saved per race (s): distribution over trials</div>
              <div className="h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={hist} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                    <XAxis dataKey="label" stroke="#5b6472" tick={{ fontSize: 10, fill: "#8a93a3" }} />
                    <YAxis stroke="#5b6472" tick={{ fontSize: 10, fill: "#8a93a3" }} width={32} allowDecimals={false} />
                    <Tooltip contentStyle={{ background: "#000", border: "1px solid #1f242d", fontSize: 11 }}
                      formatter={(v: number) => [`${v} races`, "count"]} labelFormatter={(l) => `${l}s to +5s`} />
                    <ReferenceLine x="0" stroke="#E8EAED" />
                    <Bar dataKey="n" isAnimationActive={false}>
                      {hist.map((b, i) => <Cell key={i} fill={b.from >= 0 ? "#22D37A" : "#FF2D3A"} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div>
              <div className="label mb-1">Mean time saved by race type (s), with win / loss rate</div>
              <div className="space-y-2">
                {cats.map((c) => {
                  const max = Math.max(...cats.map((x) => Math.abs(x.mean_saved_s)), 1);
                  return (
                    <div key={c.k} className="grid grid-cols-[110px_1fr_150px] items-center gap-2 text-[11px]">
                      <span className="uppercase">{c.k.replace(/_/g, " ")} <span className="text-muted">n={c.n}</span></span>
                      <div className="h-3 bg-line relative">
                        <div className="absolute h-full" style={{
                          left: c.mean_saved_s >= 0 ? "50%" : `${50 - (Math.abs(c.mean_saved_s) / max) * 50}%`,
                          width: `${(Math.abs(c.mean_saved_s) / max) * 50}%`,
                          background: c.mean_saved_s >= 0 ? "#22D37A" : "#FF2D3A" }} />
                        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-white/60" />
                      </div>
                      <span className="text-right">{c.mean_saved_s.toFixed(2)}s - {pct(c.win_rate)}W / {pct(c.loss_rate)}L</span>
                    </div>
                  );
                })}
              </div>
              <p className="text-[10px] text-muted mt-3">
                Dry races are expected to be near a tie: the baseline plan is close to optimal when nothing unexpected happens.
              </p>
            </div>
          </div>
        </>
      )}
    </Panel>
  );
}
