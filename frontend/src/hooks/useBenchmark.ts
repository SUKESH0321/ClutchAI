import { useCallback, useEffect, useState } from "react";
import { api } from "../services/api";
import type { BenchmarkResults, BenchmarkStatus } from "../types/race";

export function useBenchmark(circuit?: string) {
  const [results, setResults] = useState<BenchmarkResults | null>(null);
  const [status, setStatus] = useState<BenchmarkStatus>({ state: "idle", completed: 0, total: 0, error: null });
  const [error, setError] = useState<string | null>(null);

  // results are per circuit: switching circuit drops the old circuit's numbers and loads that circuit's own (or none)
  const loadResults = useCallback(() => {
    setResults(null);
    api.evalResults(circuit).then(setResults).catch(() => setResults(null));
  }, [circuit]);

  useEffect(() => {
    loadResults();
    api.evalStatus().then(setStatus).catch(() => undefined);
  }, [loadResults]);

  useEffect(() => {
    if (status.state !== "running") return;
    const id = window.setInterval(() => {
      api.evalStatus().then((s) => {
        setStatus(s);
        if (s.state === "done") loadResults();
      }).catch(() => undefined);
    }, 700);
    return () => window.clearInterval(id);
  }, [status.state, loadResults]);

  const run = useCallback(async (trials: number, seedStart: number) => {
    setError(null);
    try {
      setStatus(await api.evalRun(trials, seedStart));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  return { results, status, error, run };
}
