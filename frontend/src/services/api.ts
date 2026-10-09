import type { BenchmarkResults, BenchmarkStatus, EventRequest, RaceState, Recommendation } from "../types/race";

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const j = await res.json();
      detail = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
    } catch {
      // body was not JSON
    }
    throw new Error(detail || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  state: () => call<RaceState>("GET", "/api/race/state"),
  configs: () => call<string[]>("GET", "/api/configs"),
  reset: (config_name?: string) => call<RaceState>("POST", "/api/race/reset", { config_name }),
  start: () => call<RaceState>("POST", "/api/race/start"),
  pause: () => call<RaceState>("POST", "/api/race/pause"),
  resume: () => call<RaceState>("POST", "/api/race/resume"),
  step: () => call<RaceState>("POST", "/api/race/step"),
  finish: () => call<RaceState>("POST", "/api/race/finish"),
  speed: (speed: number) => call<RaceState>("POST", "/api/race/speed", { speed }),
  event: (e: EventRequest) => call<RaceState>("POST", "/api/race/event", e),
  recommendation: (refresh: boolean) =>
    call<Recommendation>("GET", `/api/strategy/recommendation?refresh=${refresh}`),
  evalRun: (trials: number, seed_start: number) =>
    call<BenchmarkStatus>("POST", "/api/evaluation/run", { trials, seed_start }),
  evalStatus: () => call<BenchmarkStatus>("GET", "/api/evaluation/status"),
  evalResults: () => call<BenchmarkResults>("GET", "/api/evaluation/results"),
};
